package prism.server;

import io.dropwizard.db.DataSourceFactory;
import io.dropwizard.jdbi3.JdbiFactory;
import io.dropwizard.lifecycle.Managed;
import io.dropwizard.setup.Environment;
import org.jdbi.v3.core.Jdbi;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import parser.ast.ModulesFile;
import prism.Prism;
import prism.PrismDevNullLog;
import prism.PrismLangException;
import prism.PrismPrintStreamLog;
import prism.api.Status;
import prism.core.Namespace;
import prism.core.Project;
import prism.db.Database;
import prism.resources.Resource;

import java.io.File;
import java.io.FileNotFoundException;
import java.util.*;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

public class TaskManager implements Executor, Managed {

    private static final Logger logger = LoggerFactory.getLogger(TaskManager.class);

    private final Environment environment;
    private final PRISMServerConfiguration configuration;

    private final Queue<Task> tasks = new ArrayDeque<>();
    private ExecutorService executor;
    private Task active;

    public AtomicBoolean refreshing = new AtomicBoolean();

    private final SocketServer socketServer;

    private final Map<String, Project> activeProjects;

    public TaskManager(Environment environment, PRISMServerConfiguration configuration) {
        this.environment = environment;
        this.configuration = configuration;
        this.executor = Executors.newSingleThreadExecutor();
        this.socketServer =  new SocketServer(configuration);
        this.activeProjects = new HashMap<>();

        this.socketServer.addEventListener(Namespace.EVENT_STATUS, String.class, (client, data, ackRequest) -> {
            String id = (String) data;
            if (this.activeProjects.get(id) == null){

                try{
                    this.loadProject(id);
                    System.out.println("loaded?");
                }catch(FileNotFoundException e){
                    System.out.println(e.getMessage());
                    socketServer.send(Namespace.EVENT_STATUS, new Status());
                    return;
                }
            }
            Status status = new Status(this.activeProjects.get(id), this.status());
            ackRequest.sendAckData(status);
        });
    }

    public TaskManager() {
        this.environment = null;
        this.configuration = null;
        this.executor = Executors.newSingleThreadExecutor();
        this.socketServer = null;
        this.activeProjects = new HashMap<>();
    }

    @Override
    public void start() throws Exception {
        this.executor = Executors.newSingleThreadExecutor();
        this.socketServer.open();
        if (active != null) {
            logger.info("Executing task {}\n", active.name());
            executor.execute(active);
        }
    }

    public void startAgain() throws Exception {
        this.executor = Executors.newSingleThreadExecutor();
        if (active != null) {
            logger.info("Executing task {}\n", active.name());
            executor.execute(active);
        }
    }

    @Override
    public void stop() throws Exception {
        try {
            this.socketServer.close();
            this.executor.shutdownNow();
        } catch (Exception e) {
            System.err.println("Error shutting down: " + e.getMessage());
            e.printStackTrace();
        }
    }

    public void stopTemp() throws Exception {
        try {
            this.executor.shutdownNow();
        } catch (Exception e) {
            System.err.println("Error shutting down: " + e.getMessage());
            e.printStackTrace();
        }
    }

    private void sendStatus(String id){
        if (socketServer != null) {
            try {
                if (this.activeProjects.get(id) == null){
                    socketServer.send(Namespace.EVENT_STATUS, new Status());
                    return;
                }
                Status status = new Status(this.activeProjects.get(id), this.status());
                socketServer.send(Namespace.EVENT_STATUS, status);
            }catch (Exception e){
                System.err.println("Error sending status to server: " + e.getMessage());
            }
        }
    }

    public void addProject(Project project){
        activeProjects.put(project.getID(), project);
    }

    public void createProject(String id) throws Exception {
        logger.info("Creating project {}\n", id);

        String databaseURL = String.format("jdbc:sqlite:%s/%s/%s", configuration.getPathTemplate(), id, Namespace.DATABASE_FILE);

        final JdbiFactory factory = new JdbiFactory();
        DataSourceFactory dbfactory = configuration.getDataSourceFactory();
        dbfactory.setUrl(databaseURL);

        final Jdbi jdbi = factory.build(environment, dbfactory, id);
        Database database = new Database(jdbi, configuration.getDebug());

        Project newProject = new Project(id, configuration.getPathTemplate(), this, database, configuration);
        this.addProject(newProject);
    }

    public Project getProject(String projectID){
        return activeProjects.get(projectID);
    }

    public boolean containsProject(String projectID){
        return activeProjects.containsKey(projectID);
    }

    private void interruptTasks(String projectID) throws Exception {
        this.stopTemp();
        List<Task> toRemove = new ArrayList<>();
        for(Task task : tasks){
            if (task.projectID().equals(projectID)){
                toRemove.add(task);
            }
        }
        tasks.removeAll(toRemove);
        if (active != null && active.projectID().equals(projectID)){
            active = tasks.poll();
        }
        this.startAgain();
    }

    public void removeProject(String projectID) throws Exception {
        this.interruptTasks(projectID);
        activeProjects.get(projectID).removeFiles();
        activeProjects.remove(projectID);
    }

    public void resetProject(String projectID) throws Exception {
        this.clearDatabase(projectID);
        Project resetProject = Project.reset(activeProjects.get(projectID));
        activeProjects.put(projectID, resetProject);
    }

    public void clearDatabase(String projectID) throws Exception {
        this.interruptTasks(projectID);
        activeProjects.get(projectID).clearTables();
    }

    public boolean containsTask(Task.Type type, String projectID){
        if (active != null && active.type().equals(type) && active.projectID().equals(projectID)){
            return true;
        }
        for(Task task : tasks){
            if (task.type().equals(type) && task.projectID().equals(projectID)){
                return true;
            }
        }
        return false;
    }

    public synchronized void execute(final Runnable r) {
        execute(new Task() {
            @Override
            public String status() {
                return "status missing";
            }

            @Override
            public String name() {
                return "runnable";
            }

            @Override
            public Type type(){
                return Type.Misc;
            }

            @Override
            public String projectID() { return ""; }

            @Override
            public void run() {
                r.run();
            }
        });
    }

    public synchronized void execute(final Task t) {
        tasks.offer(new Task() {
            @Override
            public void run() {
                try {
                    t.run();
                } finally {
                    logger.info("Task {} executed", t.name());
                    sendStatus(t.projectID());
                    scheduleNext();
                }
            }

            @Override
            public String status() { return t.status();}

            @Override
            public String name() { return t.name();}

            @Override
            public Type type(){ return t.type();}

            @Override
            public String projectID() { return t.projectID();}
        });
        if (active == null) {
            scheduleNext();
        }
    }

    protected synchronized void scheduleNext() {
        if ((active = tasks.poll()) != null) {
            logger.info("Executing task {}\n", active.name());
            executor.execute(active);
        }
    }

    public List<String> status(){
        List<String> currentTasks = new ArrayList<>();
        if (active != null) {
            currentTasks.add(active.status());
            for (Task task : tasks) {
                currentTasks.add(task.status());
            }
        }else{
            currentTasks.add("All tasks finished");
        }
        return currentTasks;
    }

    public String checkParse(File modelFile, boolean debug) {
        Prism prism = debug ? new Prism(new PrismPrintStreamLog(System.out)) : new Prism(new PrismDevNullLog());
        try {
            ModulesFile modulesFile = prism.parseModelFile(modelFile);
        } catch (FileNotFoundException e) {
            throw new RuntimeException(e);
        } catch (PrismLangException e) {
            return e.getMessage();
        }
        return null;
    }

    protected void loadProject(String projectID) throws FileNotFoundException {
        Resource.loadProject(this, projectID, configuration);
    }
}

