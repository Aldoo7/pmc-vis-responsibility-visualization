package prism.server;

import io.dropwizard.db.DataSourceFactory;
import io.dropwizard.jdbi3.JdbiFactory;
import io.dropwizard.lifecycle.Managed;
import io.dropwizard.setup.Environment;
import org.jdbi.v3.core.Jdbi;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import prism.api.Status;
import prism.core.Namespace;
import prism.core.Project;
import prism.db.Database;

import java.util.*;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class TaskManager implements Executor, Managed {

    private static final Logger logger = LoggerFactory.getLogger(TaskManager.class);

    private final Queue<Task> tasks = new ArrayDeque<>();
    private ExecutorService executor;
    private Task active;

    private final HttpClient httpClient;

    private final Map<String, Project> activeProjects;

    public TaskManager(HttpClient httpClient) {
        this.executor = Executors.newSingleThreadExecutor();
        this.httpClient = httpClient;
        this.activeProjects = new HashMap<>();
    }

    public TaskManager() {
        this.executor = Executors.newSingleThreadExecutor();
        this.httpClient = null;
        this.activeProjects = new HashMap<>();
    }

    @Override
    public void start() throws Exception {
        this.executor = Executors.newSingleThreadExecutor();
        if (active != null) {
            logger.info("Executing task {}\n", active.name());
            executor.execute(active);
        }
    }

    @Override
    public void stop() throws Exception {
        try {
            this.executor.shutdownNow();
        } catch (Exception e) {
            System.err.println("Error shutting down executor: " + e.getMessage());
            e.printStackTrace();
        }
    }

    private void sendStatus(String id){
        if (httpClient != null) {
            try {
                Status status = new Status(this.activeProjects.get(id), this.status());
                httpClient.send(status);
            }catch (Exception e){
                System.err.println("Error sending status to server: " + e.getMessage());
            }
        }
    }

    public void addProject(Project project){
        activeProjects.put(project.getID(), project);
    }

    public void createProject(String id, Environment environment, PRISMServerConfiguration config) throws Exception {
        logger.info("Creating project {}\n", id);

        String databaseURL = String.format("jdbc:sqlite:%s/%s/%s", config.getPathTemplate(), id, Namespace.DATABASE_FILE);

        final JdbiFactory factory = new JdbiFactory();
        DataSourceFactory dbfactory = config.getDataSourceFactory();
        dbfactory.setUrl(databaseURL);

        final Jdbi jdbi = factory.build(environment, dbfactory, id);
        Database database = new Database(jdbi, config.getDebug());

        Project newProject = new Project(id, config.getPathTemplate(), this, database, config);
        this.addProject(newProject);
    }

    public Project getProject(String projectID){
        return activeProjects.get(projectID);
    }

    public boolean containsProject(String projectID){
        return activeProjects.containsKey(projectID);
    }

    private void interruptTasks(String projectID) throws Exception {
        this.stop();
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
        this.start();
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
}

