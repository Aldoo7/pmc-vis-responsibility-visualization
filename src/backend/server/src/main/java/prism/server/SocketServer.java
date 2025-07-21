package prism.server;

import com.corundumstudio.socketio.*;
import io.dropwizard.lifecycle.Managed;

import java.util.concurrent.Executors;

public class SocketServer implements AutoCloseable {

    private SocketIOServer server;

    public SocketServer(PRISMServerConfiguration configuration)  {
        Configuration config = new Configuration();
        config.setPort(configuration.getSocketPort());
        config.setHostname(configuration.getSocketHost());

        server = new SocketIOServer(config);

        server.addConnectListener(
                (client) -> {
                    System.out.println("Client has Connected!");
                });

        server.addDisconnectListener(
                (client) -> {
                    System.out.println("Client has Disconnected!");
                });

        server.addEventListener("MESSAGE", String.class,
                (client, message, ackRequest) -> {
                    System.out.println("Client said: " + message);
                });

        server.start();
    }

    @Override
    public void close() throws Exception {
        this.server.stop();
    }

    public void send(String event, Object data) {
        this.server.getBroadcastOperations().sendEvent(event, data);
    }
}
