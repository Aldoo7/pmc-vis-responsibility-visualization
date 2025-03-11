package prism.server;

import io.dropwizard.client.JerseyClientBuilder;
import io.dropwizard.setup.Environment;

import javax.ws.rs.client.Client;
import javax.ws.rs.client.Entity;
import javax.ws.rs.client.WebTarget;
import javax.ws.rs.core.MediaType;
import java.util.List;

public class HttpClient {

    private final Client client;
    private String url;

    public HttpClient(Environment environment, PRISMServerConfiguration configuration) {

        this.client = new JerseyClientBuilder(environment).using(configuration.getJerseyClientConfiguration()).build("pmc-vis-backend");
        this.url = configuration.getFrontendUrl();
    }

    public void send(List<String> messages) {
        WebTarget target = client.target(url);
        target.request(MediaType.APPLICATION_JSON_TYPE).post(Entity.entity(messages, MediaType.APPLICATION_JSON_TYPE));
    }


}
