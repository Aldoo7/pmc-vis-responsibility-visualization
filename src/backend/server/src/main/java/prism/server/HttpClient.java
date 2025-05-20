package prism.server;

import io.dropwizard.client.JerseyClientBuilder;
import io.dropwizard.setup.Environment;
import prism.api.Status;

import javax.ws.rs.client.Client;
import javax.ws.rs.client.Entity;
import javax.ws.rs.client.WebTarget;
import javax.ws.rs.core.MediaType;
import java.util.List;

public class HttpClient {

    private final Client client;
    private String frontURL;
    private String editorURL;

    public HttpClient(Environment environment, PRISMServerConfiguration configuration) {

        this.client = new JerseyClientBuilder(environment).using(configuration.getJerseyClientConfiguration()).build("pmc-vis-backend");
        this.frontURL = configuration.getFrontendUrl();
        this.editorURL = configuration.getEditorUrl();
    }

    public void send(List<String> messages, String url) {
        WebTarget target = client.target(url);
        target.request(MediaType.APPLICATION_JSON_TYPE).post(Entity.entity(messages, MediaType.APPLICATION_JSON_TYPE));
    }

    public void send(Status status, String url) {
        WebTarget target = client.target(url);
        target.request(MediaType.APPLICATION_JSON_TYPE).post(Entity.entity(status, MediaType.APPLICATION_JSON_TYPE));
    }

    public void send(List<String> messages) {
        try {
            send(messages, frontURL);
        } catch (Exception e) {
            System.out.println(String.format("Error sending request to frontend at %s: %s", frontURL, e.getMessage()));
        }
        try {
            send(messages, editorURL);
        } catch (Exception e) {
            System.out.println(String.format("Error sending request to editor at %s: %s", editorURL, e.getMessage()));
        }
    }

    public void send(Status status) {
        try {
            send(status, frontURL);
        } catch (Exception e) {
            System.out.println(String.format("Error sending request to frontend at %s: %s", frontURL, e.getMessage()));
        }
        try {
            send(status, editorURL);
        } catch (Exception e) {
            System.out.println(String.format("Error sending request to editor at %s: %s", editorURL, e.getMessage()));
        }
    }


}
