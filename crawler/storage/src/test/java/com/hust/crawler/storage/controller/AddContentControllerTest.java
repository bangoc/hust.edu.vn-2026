package com.hust.crawler.storage.controller;

import com.hust.crawler.storage.submission.SubmittedContent;
import com.hust.crawler.storage.submission.SubmittedContentService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.time.Instant;
import java.util.List;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class AddContentControllerTest {
    SubmittedContentService service;
    MockMvc mvc;
    String body(String links) {
        return """
            {"url":"https://hust.edu.vn/tin-tuc1", "format":"HTML", "title":"Tin tức 1",
             "content":"Nội dung bóc tách", "out-links":%s}
            """.formatted(links);
    }
    @BeforeEach void setup() {
        service = mock(SubmittedContentService.class);
        mvc = MockMvcBuilders.standaloneSetup(new AddContentController(service)).build();
        when(service.save(anyString(), anyString(), anyString(), anyString(), anyList()))
                .thenAnswer(i -> new SubmittedContent(i.getArgument(0), i.getArgument(0), i.getArgument(1),
                        i.getArgument(2), i.getArgument(3), i.getArgument(4), Instant.EPOCH, Instant.EPOCH));
    }
    @Test void acceptsTypedRequestAndNormalizesFormat() throws Exception {
        mvc.perform(post("/add").contentType("application/json")
                .content(body("[{\"url\":\"https://hust.edu.vn/2\",\"text\":\"Liên kết\"}]")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.format").value("html"))
                .andExpect(jsonPath("$['out-links'][0].text").value("Liên kết"));
        verify(service).save("https://hust.edu.vn/tin-tuc1", "html", "Tin tức 1", "Nội dung bóc tách",
                List.of(new SubmittedContent.OutLink("https://hust.edu.vn/2", "Liên kết")));
    }
    @Test void acceptsMultipleLinks() throws Exception {
        mvc.perform(post("/add").contentType("application/json").content(body("""
            [{"url":"https://hust.edu.vn/2","text":"Hai"},{"url":"https://hust.edu.vn/3","text":""}]
            """))).andExpect(status().isOk()).andExpect(jsonPath("$['out-links'].length()").value(2));
    }
    @Test void rejectsInvalidLinkWithoutWriting() throws Exception {
        mvc.perform(post("/add").contentType("application/json").content(body("[{\"url\":\"javascript:alert(1)\",\"text\":\"X\"}]")))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(service);
    }
    @Test void rejectsMalformedJsonAndMissingFields() throws Exception {
        mvc.perform(post("/add").contentType("application/json").content("{broken"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/add").contentType("application/json").content("{}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/add").contentType("application/json").content(body("[\"https://hust.edu.vn/2\"]")))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(service);
    }
    @Test void rejectsNullLinkAndMissingLinkText() throws Exception {
        for (String links : List.of("[null]", "[{\"url\":\"https://hust.edu.vn/2\"}]")) {
            mvc.perform(post("/add").contentType("application/json").content(body(links)))
                    .andExpect(status().isBadRequest());
        }
        verifyNoInteractions(service);
    }
    @Test void reportsUnavailableDatabase() throws Exception {
        when(service.save(anyString(),anyString(),anyString(),anyString(),anyList()))
                .thenThrow(new DataAccessResourceFailureException("down"));
        mvc.perform(post("/add").contentType("application/json").content(body("[]")))
                .andExpect(status().isServiceUnavailable());
    }
}
