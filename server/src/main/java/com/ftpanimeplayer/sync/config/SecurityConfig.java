package com.ftpanimeplayer.sync.config;

import java.util.ArrayList;
import java.util.List;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.util.matcher.AntPathRequestMatcher;

@Configuration
@EnableConfigurationProperties(SyncProperties.class)
public class SecurityConfig {

    @Bean
    public PasswordEncoder passwordEncoder() {
        return PasswordEncoderFactories.createDelegatingPasswordEncoder();
    }

    @Bean
    public UserDetailsService userDetailsService(SyncProperties properties, PasswordEncoder encoder) {
        List<UserDetails> users = new ArrayList<>();
        for (SyncProperties.UserEntry entry : properties.getUsers()) {
            if (entry.getUsername() == null || entry.getUsername().isBlank()) {
                continue;
            }
            if (entry.getPassword() == null || entry.getPassword().isBlank()) {
                continue;
            }
            String stored = entry.getPassword();
            // Passwords without a `{id}` prefix are assumed to be plain text and
            // encoded at startup. The encoded form is held in-memory only.
            if (!stored.startsWith("{")) {
                stored = encoder.encode(stored);
            }
            users.add(User.withUsername(entry.getUsername())
                    .password(stored)
                    .roles("SYNC")
                    .build());
        }
        return new InMemoryUserDetailsManager(users);
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                .securityMatcher(new AntPathRequestMatcher("/api/**"))
                .csrf(csrf -> csrf.disable())
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(new AntPathRequestMatcher("/api/health")).permitAll()
                        .anyRequest().hasRole("SYNC"))
                .httpBasic(basic -> {
                });
        return http.build();
    }
}
