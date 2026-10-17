package xyz.waypoint.domain;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import java.time.LocalDateTime;

@Entity
@Table(name = "user_submission_logs")
@Getter
@Setter
@NoArgsConstructor
public class UserSubmissionLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private String userId;

    @Column(name = "question_id", nullable = false)
    private Long questionId;

    @Column(name = "selected_answer", nullable = false)
    private String selectedAnswer;

    @Column(name = "correct_answer", nullable = false)
    private String correctAnswer;

    @Column(name = "is_correct", nullable = false)
    @JsonProperty("isCorrect")
    private boolean isCorrect;

    @JsonProperty("isCorrect")
    public boolean getIsCorrect() {
        return isCorrect;
    }

    @JsonProperty("isCorrect")
    public boolean isCorrect() {
        return isCorrect;
    }

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt = LocalDateTime.now();
}
