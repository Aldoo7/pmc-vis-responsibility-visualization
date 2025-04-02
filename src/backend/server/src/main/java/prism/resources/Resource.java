package prism.resources;

import io.dropwizard.setup.Environment;
import prism.api.Message;
import prism.core.Namespace;
import prism.core.Project;
import prism.server.PRISMServerConfiguration;
import prism.server.TaskManager;

import javax.ws.rs.core.Response;
import java.io.*;
import java.util.Map;

public abstract class Resource {

    protected final Environment environment;
    protected final PRISMServerConfiguration configuration;

    protected final String rootDir;
    protected final long cuddMaxMem;

    protected final int maxIterations;
    protected final boolean debug;

    protected TaskManager tasks;

    protected Resource(Environment environment, PRISMServerConfiguration configuration, TaskManager tasks){
        this.environment = environment;
        this.configuration = configuration;
        this.rootDir = configuration.getPathTemplate();
        this.debug = configuration.getDebug();
        this.cuddMaxMem = configuration.getCUDDMaxMem();
        this.maxIterations = configuration.getIterations();
        this.tasks = tasks;
    }

    private Map<String, Project> currModels;

    protected static Response ok(Object o){
        return Response.ok(o).build();
    }

    protected static Response missing(Message m){
        return Response.status(Response.Status.NOT_FOUND).entity(m).build();
    }

    protected static Response error(Object o){
        System.out.println(o);
        return Response.status(Response.Status.INTERNAL_SERVER_ERROR).entity(o).build();
    }

    protected static Response abstractionMissing(long abstractionID){
        return missing(new Message(String.format("AbstractionID %s has not been found", abstractionID)));
    }

    // save uploaded file to new location
    protected void writeToFile(InputStream uploadedInputStream, String uploadedFileLocation) throws IOException {
        int read;
        final int BUFFER_LENGTH = 1024;
        final byte[] buffer = new byte[BUFFER_LENGTH];
        OutputStream out = new FileOutputStream(uploadedFileLocation);
        while ((read = uploadedInputStream.read(buffer)) != -1) {
            out.write(buffer, 0, read);
        }
        out.flush();
        out.close();
    }

    protected void createStyleFile(String projectID) throws IOException {
        File style = new File(String.format("%s/%s/", rootDir, projectID) + Namespace.STYLE_FILE);
        if (style.createNewFile()){
            try(FileWriter w = new FileWriter(style)){
                w.write(Namespace.DEFAULT_STYLE);
            }
        }
    }

    protected void refreshProject(String projectID){

        if (tasks.containsProject(projectID)) {
            //Project Already exists, refresh (model and) propertyfile
            Project project = tasks.getProject(projectID);
            project.refreshProject();
        }else{
            //Project not initialized, initialize with current Files
            loadProject(projectID);
        }
    }


    protected void loadProject(String projectID){
        File projectdir = new File(String.format("%s/%s", rootDir, projectID));
        loadProject(projectdir);
    }

    protected void loadProject(File file){
        if (file.isDirectory()){
            try {
                String projectID = file.getName();
                createStyleFile(projectID);
                tasks.createProject(projectID, environment, configuration);
            } catch (Exception e) {
                System.out.println(e);
            }
        }
    }
}
