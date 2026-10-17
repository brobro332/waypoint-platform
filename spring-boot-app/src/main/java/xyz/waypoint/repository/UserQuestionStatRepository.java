package xyz.waypoint.repository;

import xyz.waypoint.domain.UserQuestionStat;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface UserQuestionStatRepository extends JpaRepository<UserQuestionStat, Long> {
    Optional<UserQuestionStat> findByUserIdAndQuestionId(String userId, Long questionId);
    List<UserQuestionStat> findByUserId(String userId);
    void deleteByUserId(String userId);
}
