package com.ftpanimeplayer.sync;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration;
import org.springframework.boot.autoconfigure.jdbc.DataSourceTransactionManagerAutoConfiguration;
import org.springframework.boot.autoconfigure.jdbc.JdbcTemplateAutoConfiguration;

/**
 * Application entry point.
 *
 * <p>The {@code spring-boot-starter-jdbc} dependency is on the classpath to
 * pull in the SQLite driver + connection utilities, but the storage layer
 * ({@link com.ftpanimeplayer.sync.persistence.LibraryStore}) opens the SQLite
 * file manually via {@link java.sql.DriverManager}. We disable Spring Boot's
 * auto-configured DataSource so the app can start without a spring.datasource.*
 * URL being set.
 */
@SpringBootApplication(exclude = {
        DataSourceAutoConfiguration.class,
        DataSourceTransactionManagerAutoConfiguration.class,
        JdbcTemplateAutoConfiguration.class
})
public class SyncServerApplication {
    public static void main(String[] args) {
        SpringApplication.run(SyncServerApplication.class, args);
    }
}
