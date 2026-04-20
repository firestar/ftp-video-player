package com.ftpanimeplayer.sync;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
        "sync.users[0].username=alice",
        "sync.users[0].password=secret"
})
class SyncEndpointsTest {

    @Autowired
    MockMvc mvc;

    @DynamicPropertySource
    static void storage(DynamicPropertyRegistry registry) throws Exception {
        Path tmp = Files.createTempDirectory("sync-test-");
        registry.add("sync.data-dir", tmp::toString);
    }

    @Test
    void healthIsPublic() throws Exception {
        mvc.perform(get("/api/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ok"));
    }

    @Test
    void authMeRequiresCredentials() throws Exception {
        mvc.perform(get("/api/auth/me"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/auth/me").with(httpBasic("alice", "secret")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value("alice"));
    }

    @Test
    void dbUploadAndDownloadRoundtrip() throws Exception {
        byte[] payload = "sqlite-bytes".getBytes();
        mvc.perform(put("/api/sync/db")
                        .with(httpBasic("alice", "secret"))
                        .contentType(MediaType.APPLICATION_OCTET_STREAM)
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.size").value(payload.length));

        mvc.perform(get("/api/sync/db").with(httpBasic("alice", "secret")))
                .andExpect(status().isOk())
                .andExpect(content().bytes(payload));

        mvc.perform(get("/api/sync/db/meta").with(httpBasic("alice", "secret")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.exists").value(true))
                .andExpect(jsonPath("$.size").value(payload.length));
    }

    @Test
    void cacheRoundtripAndListing() throws Exception {
        byte[] png = new byte[]{(byte) 0x89, 0x50, 0x4e, 0x47};
        mvc.perform(put("/api/sync/cache/posters/abcd1234.jpg")
                        .with(httpBasic("alice", "secret"))
                        .contentType(MediaType.APPLICATION_OCTET_STREAM)
                        .content(png))
                .andExpect(status().isOk());

        mvc.perform(get("/api/sync/cache/posters/abcd1234.jpg").with(httpBasic("alice", "secret")))
                .andExpect(status().isOk())
                .andExpect(content().bytes(png));

        mvc.perform(get("/api/sync/cache/posters").with(httpBasic("alice", "secret")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.count").value(1))
                .andExpect(jsonPath("$.files[0].name").value("abcd1234.jpg"));
    }

    @Test
    void cacheRejectsPathTraversal() throws Exception {
        mvc.perform(get("/api/sync/cache/posters/..%2fescape")
                        .with(httpBasic("alice", "secret")))
                .andExpect(status().isBadRequest());
    }

    @Test
    void cacheRejectsUnknownKind() throws Exception {
        mvc.perform(get("/api/sync/cache/bogus").with(httpBasic("alice", "secret")))
                .andExpect(status().isBadRequest());
    }
}
