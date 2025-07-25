package prism.server;

import com.corundumstudio.socketio.*;
import com.corundumstudio.socketio.listener.DataListener;
import io.dropwizard.lifecycle.Managed;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.net.BindException;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;

public class SocketServer implements AutoCloseable {

    private static final Logger logger = LoggerFactory.getLogger(SocketIOServer.class);;

    private SocketIOServer server;

    private final String EVENT_STATE_SELECTED = "STATE_SELECTED";

    private boolean excludeSender = true;

    public SocketServer(PRISMServerConfiguration configuration)  {
        Configuration config = new Configuration();
        config.setPort(configuration.getSocketPort());
        config.setHostname(configuration.getSocketHost());

        server = new SocketIOServer(config);



        server.addConnectListener(
                (client) -> {
                    logger.info("Client has Connected!");
                });

        server.addDisconnectListener(
                (client) -> {
                    logger.info("Client has Disconnected!");
                });

        //Equivalent to server.on()
        server.addEventListener("MESSAGE", Object.class,
                (client, data, ackRequest) -> {
                    //print the data
                    logger.info("Client said: " + data.toString());
                    if(excludeSender){
                        //socket.broadcast("event", data)
                        server.getBroadcastOperations().sendEvent("MESSAGE", client, data);
                    }else{
                        //server.emit("event", data)
                        server.getBroadcastOperations().sendEvent("MESSAGE", data);
                    }
                });

        this.addEventBroadcast(EVENT_STATE_SELECTED);
    }

    public void addEventBroadcast(String event) {
        server.addEventListener(event, Object.class,
                (client, data, ackRequest) -> {
                    if(this.excludeSender){
                        //socket.broadcast("event", data)
                        server.getBroadcastOperations().sendEvent(event, client, data);
                    }else{
                        //server.emit("event", data)
                        server.getBroadcastOperations().sendEvent(event, data);
                    }
                });
    }

    public void addEventListener(String event, Class objectClass, DataListener listener) {
        server.addEventListener(event, objectClass, listener);
    }

    @Override
    public void close() throws Exception {
        this.server.stop();
    }

    public void open() throws InterruptedException {
        boolean connected = false;
        int waittime = 3000;
        while(!connected)
        try{
            this.server.start();
            connected = true;
        }catch (Exception e){
            logger.info(String.format("retrying connection in %s miliseconds", waittime));
            Thread.sleep(waittime);
            connected = false;
        }

    }

    public void send(String event, Object data) {
        this.server.getBroadcastOperations().sendEvent(event, data);
    }
}
