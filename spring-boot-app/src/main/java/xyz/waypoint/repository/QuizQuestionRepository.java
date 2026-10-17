package xyz.waypoint.repository;

import xyz.waypoint.domain.QuizQuestion;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface QuizQuestionRepository extends JpaRepository<QuizQuestion, Long> {
    List<QuizQuestion> findByCategoryStartingWith(String categoryPrefix);
    List<QuizQuestion> findAllByOrderByIdAsc();
}
