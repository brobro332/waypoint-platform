package xyz.waypoint.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import reactor.core.publisher.Flux;

import xyz.waypoint.domain.ConversationMessage;
import xyz.waypoint.domain.UserQuestionStat;
import xyz.waypoint.repository.ConversationMessageRepository;
import xyz.waypoint.repository.UserQuestionStatRepository;

import java.io.IOException;
import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class AiTutoringService {

    @Value("${app.gemini.api-key}")
    private String geminiApiKey;

    @Value("${app.groq.api-key}")
    private String groqApiKey;

    private final ConversationMessageRepository conversationRepo;
    private final UserQuestionStatRepository statRepo;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final WebClient webClient = WebClient.create();

    public SseEmitter askQuestionStream(String userId, Long questionId, String passage, String answer, String explanation, String userQuery) {
        SseEmitter emitter = new SseEmitter(60000L); // 60 seconds timeout

        // Load stats
        UserQuestionStat stat = statRepo.findByUserIdAndQuestionId(userId, questionId).orElse(new UserQuestionStat());
        int wrongCount = stat.getWrongCount();

        // Load conversation history (sliding window of last 6 messages = 3 turns)
        List<ConversationMessage> history = conversationRepo.findTop10ByUserIdAndQuestionIdOrderByCreatedAtDesc(userId, questionId);
        Collections.reverse(history); // chronological order

        String prompt = buildPrompt(passage, answer, explanation, userQuery, wrongCount, history);

        // Save user message
        ConversationMessage userMsg = new ConversationMessage();
        userMsg.setUserId(userId);
        userMsg.setQuestionId(questionId);
        userMsg.setRole("user");
        userMsg.setContent(userQuery);
        conversationRepo.save(userMsg);

        // 멀티 폴백 체인 구성
        Flux<String> aiStream = getGeminiStream(prompt, "gemini-3.5-flash")
            .onErrorResume(e -> {
                log.warn("Gemini 3.5 API failed, falling back to Gemini 3.8: {}", e.getMessage());
                return getGeminiStream(prompt, "gemini-3.8-flash");
            })
            .onErrorResume(e -> {
                log.warn("Gemini API failed, falling back to Groq Qwen: {}", e.getMessage());
                return getGroqStream(prompt, "qwen/qwen3.8-27b", 850); 
            })
            .onErrorResume(e -> {
                log.warn("Groq Qwen API failed, falling back to Groq GPT-OSS: {}", e.getMessage());
                return getGroqStream(prompt, "openai/gpt-oss-20b", 850);
            });
        
        StringBuilder fullResponse = new StringBuilder();
        aiStream.subscribe(
            chunk -> {
                try {
                    fullResponse.append(chunk);
                    emitter.send(SseEmitter.event().data(Map.of("text", chunk)));
                } catch (IOException e) {
                    emitter.completeWithError(e);
                }
            },
            error -> {
                if (error instanceof org.springframework.web.reactive.function.client.WebClientResponseException) {
                    org.springframework.web.reactive.function.client.WebClientResponseException wce = (org.springframework.web.reactive.function.client.WebClientResponseException) error;
                    log.error("Streaming error: {} - Body: {}", error.getMessage(), wce.getResponseBodyAsString());
                } else {
                    log.error("Streaming error", error);
                }
                try {
                    emitter.send(SseEmitter.event().data(Map.of("text", "\n\n앗, 서버 연결에 문제가 생겼어. 다시 시도해 줄래?")));
                } catch (IOException e) {
                    // ignore
                }
                emitter.complete();
            },
            () -> {
                // Save AI message
                ConversationMessage aiMsg = new ConversationMessage();
                aiMsg.setUserId(userId);
                aiMsg.setQuestionId(questionId);
                aiMsg.setRole("tutor");
                aiMsg.setContent(fullResponse.toString());
                conversationRepo.save(aiMsg);
                emitter.complete();
            }
        );

        return emitter;
    }

    private String buildPrompt(String passage, String answer, String explanation, String userQuery, int wrongCount, List<ConversationMessage> history) {
        StringBuilder sb = new StringBuilder();
        sb.append("당신은 컴활 1급 전문 AI 튜터입니다. 다정하고 친절한 과외선생님처럼 반말과 존댓말을 섞어서 설명해주세요. 토큰 한도가 제한되어 있으므로 핵심만 간결하고 짧게 요약해서 설명해야 합니다. 절대로 답변을 길게 늘어놓지 마세요.\n\n");
        sb.append("[문제 내용]: ").append(passage).append("\n");
        sb.append("[정답]: ").append(answer).append("\n");
        sb.append("[기본 해설]: ").append(explanation).append("\n\n");
        
        if (wrongCount >= 3) {
            sb.append("[사용자 상태]: 이 문제를 이전에도 ").append(wrongCount).append("번이나 틀렸습니다.\n");
            sb.append("[지시사항]: 사용자가 반복해서 틀리고 있으므로, 단순 정답 설명보다는 왜 이 보기가 오답으로 유도되는지 '함정 포인트'를 짚어주고, 암기하기 쉬운 암기 팁이나 실생활 비유를 들어서 아주 친절하게 설명하세요.\n\n");
        } else if (wrongCount > 0) {
            sb.append("[사용자 상태]: 이 문제를 ").append(wrongCount).append("번 틀렸습니다. 헷갈리는 부분을 잘 짚어주세요.\n\n");
        }

        if (!history.isEmpty()) {
            sb.append("[이전 대화 맥락]\n");
            for (ConversationMessage msg : history) {
                sb.append(msg.getRole().equals("user") ? "사용자: " : "튜터: ").append(msg.getContent()).append("\n");
            }
            sb.append("\n");
        }

        sb.append("[사용자 질문]: ").append(userQuery).append("\n");
        return sb.toString();
    }

    private Flux<String> getGeminiStream(String prompt, String modelName) {
        String url = "https://generativelanguage.googleapis.com/v1beta/models/" + modelName + ":streamGenerateContent?alt=sse&key=" + geminiApiKey;
        Map<String, Object> requestBody = Map.of(
            "contents", List.of(
                Map.of(
                    "role", "user",
                    "parts", List.of(Map.of("text", prompt))
                )
            )
        );

        return webClient.post()
                .uri(url)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(requestBody)
                .retrieve()
                .bodyToFlux(String.class)
                .mapNotNull(this::parseGeminiChunk);
    }

    private Flux<String> getGroqStream(String prompt, String modelName, int maxTokens) {
        String url = "https://api.groq.com/openai/v1/chat/completions";
        Map<String, Object> requestBody = Map.of(
            "model", modelName,
            "messages", List.of(Map.of("role", "user", "content", prompt)),
            "max_completion_tokens", maxTokens,
            "stream", true
        );

        return webClient.post()
                .uri(url)
                .header("Authorization", "Bearer " + groqApiKey)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(requestBody)
                .retrieve()
                .bodyToFlux(String.class)
                .mapNotNull(this::parseGroqChunk);
    }

    private String parseGeminiChunk(String chunk) {
        try {
            if (chunk == null || chunk.isEmpty() || chunk.equals("[DONE]")) return null;
            JsonNode root = objectMapper.readTree(chunk);
            String text = root.path("candidates").path(0).path("content").path("parts").path(0).path("text").asText("");
            return text.isEmpty() ? null : text;
        } catch (Exception e) {
            return null;
        }
    }

    private String parseGroqChunk(String chunk) {
        try {
            if (chunk == null || chunk.isEmpty() || chunk.equals("[DONE]")) return null;
            JsonNode root = objectMapper.readTree(chunk);
            String text = root.path("choices").path(0).path("delta").path("content").asText("");
            return text.isEmpty() ? null : text;
        } catch (Exception e) {
            return null;
        }
    }
}
