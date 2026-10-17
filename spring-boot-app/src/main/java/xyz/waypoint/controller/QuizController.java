package xyz.waypoint.controller;

import xyz.waypoint.domain.ConversationMessage;
import xyz.waypoint.domain.QuizQuestion;
import xyz.waypoint.domain.UserQuestionStat;
import xyz.waypoint.domain.UserSubmissionLog;
import xyz.waypoint.repository.ConversationMessageRepository;
import xyz.waypoint.repository.QuizQuestionRepository;
import xyz.waypoint.repository.UserQuestionStatRepository;
import xyz.waypoint.repository.UserSubmissionLogRepository;
import xyz.waypoint.service.AiTutoringService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/quiz")
@RequiredArgsConstructor
public class QuizController {

    private final QuizQuestionRepository repository;
    private final UserQuestionStatRepository statRepository;
    private final UserSubmissionLogRepository submissionLogRepository;
    private final ConversationMessageRepository conversationRepository;
    private final AiTutoringService aiTutoringService;

    @GetMapping
    public ResponseEntity<List<QuizQuestion>> getAllQuestions(
            @RequestParam(required = false) String category) {
        if (category != null && !category.isBlank()) {
            return ResponseEntity.ok(repository.findByCategoryStartingWith(category));
        }
        return ResponseEntity.ok(repository.findAllByOrderByIdAsc());
    }

    @GetMapping("/{id}")
    public ResponseEntity<QuizQuestion> getQuestion(@PathVariable Long id) {
        return repository.findById(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/{id}/submit")
    @Transactional
    public ResponseEntity<Map<String, Object>> submitAnswer(
            @PathVariable Long id,
            @RequestBody Map<String, String> request,
            @RequestHeader(value = "X-User-Id", defaultValue = "default_user") String userId) {
        
        String selectedAnswer = request.get("selectedAnswer");
        if (selectedAnswer == null || selectedAnswer.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "답안을 선택해주세요."));
        }

        QuizQuestion question = repository.findById(id)
                .orElseThrow(() -> new RuntimeException("문제를 찾을 수 없습니다."));

        boolean isCorrect = question.getAnswer().trim().equals(selectedAnswer.trim());

        // 1. 개별 제출 이력 로그 (UserSubmissionLog) 적재
        UserSubmissionLog log = new UserSubmissionLog();
        log.setUserId(userId);
        log.setQuestionId(id);
        log.setSelectedAnswer(selectedAnswer);
        log.setCorrectAnswer(question.getAnswer());
        log.setCorrect(isCorrect);
        submissionLogRepository.save(log);

        // 2. 문제별 누적 풀이 통계 (UserQuestionStat) 갱신
        UserQuestionStat stat = statRepository.findByUserIdAndQuestionId(userId, id)
                .orElseGet(() -> {
                    UserQuestionStat newStat = new UserQuestionStat();
                    newStat.setUserId(userId);
                    newStat.setQuestionId(id);
                    return newStat;
                });

        stat.setTryCount(stat.getTryCount() + 1);
        stat.setLastSelectedAnswer(selectedAnswer);
        stat.setIsCorrect(isCorrect);
        stat.setLastSolvedAt(LocalDateTime.now());
        if (isCorrect) {
            stat.setResolved(true);
        } else {
            stat.setWrongCount(stat.getWrongCount() + 1);
        }
        statRepository.save(stat);

        // 해당 문제의 전체 풀이 이력
        List<UserSubmissionLog> attempts = submissionLogRepository.findByUserIdAndQuestionIdOrderByCreatedAtDesc(userId, id);

        Map<String, Object> result = new HashMap<>();
        result.put("questionId", id);
        result.put("selectedAnswer", selectedAnswer);
        result.put("correctAnswer", question.getAnswer());
        result.put("isCorrect", isCorrect);
        result.put("explanation", question.getExplanation());
        result.put("tryCount", stat.getTryCount());
        result.put("wrongCount", stat.getWrongCount());
        result.put("hasWrongHistory", stat.getWrongCount() > 0);
        result.put("isResolved", stat.isResolved());
        result.put("attempts", attempts);

        return ResponseEntity.ok(result);
    }

    @GetMapping("/stats")
    public ResponseEntity<Map<String, Object>> getUserStats(
            @RequestHeader(value = "X-User-Id", defaultValue = "default_user") String userId) {
        
        List<UserQuestionStat> stats = statRepository.findByUserId(userId);
        long totalQuestions = repository.count();
        long solvedCount = stats.size();
        
        // 한번이라도 틀린 이력이 있는 문제 수 (wrongCount > 0)
        long everWrongCount = stats.stream().filter(s -> s.getWrongCount() > 0).count();
        // 한번의 오답도 없이 바로 맞힌 문제 수 (wrongCount == 0 && isCorrect == true)
        long perfectCount = stats.stream().filter(s -> s.getWrongCount() == 0 && Boolean.TRUE.equals(s.getIsCorrect())).count();
        
        List<UserSubmissionLog> allLogs = submissionLogRepository.findByUserIdOrderByCreatedAtDesc(userId);
        List<ConversationMessage> allConversations = conversationRepository.findByUserIdOrderByCreatedAtAsc(userId);

        Map<String, Object> response = new HashMap<>();
        response.put("totalQuestions", totalQuestions);
        response.put("solvedCount", solvedCount);
        response.put("everWrongCount", everWrongCount);
        response.put("perfectCount", perfectCount);
        response.put("totalAttempts", allLogs.size());
        response.put("stats", stats);
        response.put("submissionLogs", allLogs);
        response.put("conversationMessages", allConversations);

        return ResponseEntity.ok(response);
    }

    @GetMapping("/{id}/history")
    public ResponseEntity<List<UserSubmissionLog>> getQuestionHistory(
            @PathVariable Long id,
            @RequestHeader(value = "X-User-Id", defaultValue = "default_user") String userId) {
        return ResponseEntity.ok(submissionLogRepository.findByUserIdAndQuestionIdOrderByCreatedAtDesc(userId, id));
    }

    @GetMapping("/history")
    public ResponseEntity<List<UserSubmissionLog>> getAllHistory(
            @RequestHeader(value = "X-User-Id", defaultValue = "default_user") String userId) {
        return ResponseEntity.ok(submissionLogRepository.findByUserIdOrderByCreatedAtDesc(userId));
    }

    @GetMapping("/{id}/conversations")
    public ResponseEntity<List<ConversationMessage>> getQuestionConversations(
            @PathVariable Long id,
            @RequestHeader(value = "X-User-Id", defaultValue = "default_user") String userId) {
        return ResponseEntity.ok(conversationRepository.findByUserIdAndQuestionIdOrderByCreatedAtAsc(userId, id));
    }

    @DeleteMapping("/conversations/{messageId}")
    @Transactional
    public ResponseEntity<Map<String, Object>> deleteConversationMessage(
            @PathVariable Long messageId,
            @RequestParam(required = false) Long pairId,
            @RequestHeader(value = "X-User-Id", defaultValue = "default_user") String userId) {
        conversationRepository.deleteByIdAndUserId(messageId, userId);
        if (pairId != null) {
            conversationRepository.deleteByIdAndUserId(pairId, userId);
        }
        return ResponseEntity.ok(Map.of("deleted", true, "messageId", messageId));
    }

    @DeleteMapping("/{id}/conversations")
    @Transactional
    public ResponseEntity<Map<String, Object>> deleteQuestionConversations(
            @PathVariable Long id,
            @RequestHeader(value = "X-User-Id", defaultValue = "default_user") String userId) {
        conversationRepository.deleteByUserIdAndQuestionId(userId, id);
        return ResponseEntity.ok(Map.of("deleted", true, "questionId", id));
    }

    @PostMapping("/stats/reset")
    @Transactional
    public ResponseEntity<Map<String, String>> resetUserStats(
            @RequestHeader(value = "X-User-Id", defaultValue = "default_user") String userId) {
        statRepository.deleteByUserId(userId);
        submissionLogRepository.deleteByUserId(userId);
        return ResponseEntity.ok(Map.of("message", "풀이 기록이 초기화되었습니다."));
    }

    @PostMapping(value = "/{id}/ask", produces = org.springframework.http.MediaType.TEXT_EVENT_STREAM_VALUE)
    public ResponseEntity<SseEmitter> askAiTutor(
            @PathVariable Long id, 
            @RequestBody Map<String, String> request,
            @RequestHeader(value = "X-User-Id", defaultValue = "default_user") String userId,
            jakarta.servlet.http.HttpServletResponse response) {
        
        // Cloudflare 및 리버스 프록시에서 SSE 실시간 스트리밍이 버퍼링되지 않도록 헤더 설정
        response.setHeader("Cache-Control", "no-cache, no-transform");
        response.setHeader("X-Accel-Buffering", "no");
        response.setHeader("Connection", "keep-alive");

        String userQuery = request.get("query"); 
        
        QuizQuestion question = repository.findById(id)
                .orElseThrow(() -> new RuntimeException("문제를 찾을 수 없습니다."));

        SseEmitter emitter = aiTutoringService.askQuestionStream(
                userId,
                id,
                question.getPassage(),
                question.getAnswer(),
                question.getExplanation(),
                userQuery
        );

        return ResponseEntity.ok(emitter);
    }
}
