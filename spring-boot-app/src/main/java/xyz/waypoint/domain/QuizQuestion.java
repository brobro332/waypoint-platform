package xyz.waypoint.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import java.time.ZonedDateTime;

@Entity
@Table(name = "quiz_question")
@Getter
@NoArgsConstructor
public class QuizQuestion {
    
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    @Column(nullable = false, columnDefinition = "TEXT")
    private String passage;
    
    @Column(nullable = false, length = 10)
    private String answer;
    
    @Column(nullable = false, columnDefinition = "TEXT")
    private String explanation;
    
    @Column(nullable = false, length = 100)
    private String category;
    
    @Column(name = "created_at", nullable = false, updatable = false)
    private ZonedDateTime createdAt = ZonedDateTime.now();
}
