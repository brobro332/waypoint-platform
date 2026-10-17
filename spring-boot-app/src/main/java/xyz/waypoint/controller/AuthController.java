package xyz.waypoint.controller;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    @Value("${app.auth.secret-password}")
    private String secretPassword;

    @Value("${app.auth.device-token}")
    private String deviceToken;

    @PostMapping("/login")
    public ResponseEntity<String> login(@RequestBody Map<String, String> request, HttpServletResponse response) {
        String password = request.get("password");
        
        if (secretPassword.equals(password)) {
            Cookie authCookie = new Cookie("GF_DEVICE_TOKEN", deviceToken);
            authCookie.setHttpOnly(true);
            authCookie.setPath("/");
            authCookie.setMaxAge(60 * 60 * 24 * 365); 
            
            response.addCookie(authCookie);
            return ResponseEntity.ok("인증 성공! 환영해 :)");
        }
        
        return ResponseEntity.status(401).body("비밀번호가 틀렸어요!");
    }
}
