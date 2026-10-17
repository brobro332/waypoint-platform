package xyz.waypoint.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import java.time.LocalDateTime;

@Entity
@Table(name = "user_question_stats")
@Getter
@Setter
@NoArgsConstructor
public class UserQuestionStat {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id")
    private String userId;

    @Column(name = "question_id")
    private Long questionId;

    @Column(name = "try_count")
    private int tryCount = 0;

    @Column(name = "wrong_count")
    private int wrongCount = 0;

    @Column(name = "is_resolved")
    @com.fasterxml.jackson.annotation.JsonProperty("isResolved")
    private boolean isResolved = false;

    @com.fasterxml.jackson.annotation.JsonProperty("isResolved")
    public boolean isResolved() {
        return isResolved;
    }

    @Column(name = "is_correct")
    @com.fasterxml.jackson.annotation.JsonProperty("isCorrect")
    private Boolean isCorrect;

    @Column(name = "last_selected_answer")
    private String lastSelectedAnswer;

    @Column(name = "last_solved_at")
    private LocalDateTime lastSolvedAt;
}
