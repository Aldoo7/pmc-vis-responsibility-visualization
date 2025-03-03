package prism.server;

import io.dropwizard.db.DataSourceFactory;
import io.dropwizard.jdbi3.JdbiFactory;
import io.dropwizard.lifecycle.Managed;
import io.dropwizard.setup.Environment;
import org.jdbi.v3.core.Jdbi;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import prism.core.Namespace;
import prism.core.Project;
import prism.db.Database;

import java.util.*;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

public class TaskManager implements Executor, Managed {

    private static final Logger logger = LoggerFactory.getLogger(TaskManager.class);

    final Queue<Task> tasks = new ArrayDeque<>();
    final Executor executor;
    Task active;

    private Map<String, Project> activeProjects;

    public TaskManager() {
        this.executor = Executors.newSingleThreadExecutor();
        this.activeProjects = new HashMap<>();
    }

    @Override
    public void start() throws Exception {

    }

    @Override
    public void stop() throws Exception {

    }

    public void addProject(Project project){
        activeProjects.put(project.getID(), project);
    }

    public void createProject(String id, Environment environment, PRISMServerConfiguration config) throws Exception {
        logger.info("Creating project {}\n", id);
        final JdbiFactory factory = new JdbiFactory();
        DataSourceFactory dbfactory = config.getDataSourceFactory();
        dbfactory.setUrl(String.format("jdbc:sqlite:%s/%s/%s", config.getPathTemplate(), id, Namespace.DATABASE_FILE));

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

    public void removeProject(String projectID) throws Exception {
        activeProjects.get(projectID).removeFiles();
        activeProjects.remove(projectID);
    }

    public boolean containsTask(Task.Type type){
        if (active != null && active.type().equals(type)){
            return true;
        }
        for(Task task : tasks){
            if (task.type().equals(type)){
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

            public String name() {
                return "runnable";
            }

            public Type type(){
                return Type.Misc;
            }

            @Override
            public void run() {
                r.run();
            }
        });
    }

    public synchronized void execute(final Task t) {
        tasks.offer(new Task() {
            public void run() {
                try {
                    t.run();
                } finally {
                    logger.info("Task {} executed", t.name());
                    scheduleNext();
                }
            }

            public String status() { return t.status();}

            public String name() { return t.name();}

            public Type type(){ return t.type();}
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
        List currentTasks = new ArrayList();
        if (active != null) {
            currentTasks.add(active.status()); //TODO: Add explanation function to each Task
            for (Task task : tasks) {
                currentTasks.add(task.status());
            }
        }
        return currentTasks;
    }
}

