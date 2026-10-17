package xyz.waypoint.repository;

import xyz.waypoint.domain.ConversationMessage;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface ConversationMessageRepository extends JpaRepository<ConversationMessage, Long> {
    List<ConversationMessage> findTop10ByUserIdAndQuestionIdOrderByCreatedAtDesc(String userId, Long questionId);
    List<ConversationMessage> findByUserIdOrderByCreatedAtAsc(String userId);
    List<ConversationMessage> findByUserIdAndQuestionIdOrderByCreatedAtAsc(String userId, Long questionId);
    void deleteByIdAndUserId(Long id, String userId);
    void deleteByUserIdAndQuestionId(String userId, Long questionId);
    void deleteByUserId(String userId);
}
