package xyz.waypoint.repository;

import xyz.waypoint.domain.UserSubmissionLog;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface UserSubmissionLogRepository extends JpaRepository<UserSubmissionLog, Long> {
    List<UserSubmissionLog> findByUserIdOrderByCreatedAtDesc(String userId);
    List<UserSubmissionLog> findByUserIdAndQuestionIdOrderByCreatedAtDesc(String userId, Long questionId);
    void deleteByUserId(String userId);
}
