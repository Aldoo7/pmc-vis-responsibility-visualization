package prism.resources;

import com.codahale.metrics.annotation.Timed;
import io.dropwizard.setup.Environment;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import org.glassfish.jersey.media.multipart.FormDataContentDisposition;
import org.glassfish.jersey.media.multipart.FormDataParam;
import prism.PrismException;
import prism.api.Message;
import prism.api.Pane;
import prism.api.Status;
import prism.core.Namespace;
import prism.core.Project;
import prism.server.PRISMServerConfiguration;
import prism.server.TaskManager;

import javax.ws.rs.*;
import javax.ws.rs.core.MediaType;
import javax.ws.rs.core.Response;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;

@Path("/{project_id}")
@Produces(MediaType.APPLICATION_JSON)
public class TaskResource extends Resource {

    public TaskResource(Environment environment, PRISMServerConfiguration configuration, TaskManager tasks) {
        super(environment, configuration, tasks);

        File[] files = Objects.requireNonNull(new File(rootDir).listFiles());
        Arrays.sort(files);
        String initProject = configuration.getInitModel();
        initModels(files, initProject);
    }

    private void initModels(File[] files, String initProject){
        if (initProject  != null){
            boolean found = false;
            for (File file : files) {
                if (file.getName().equals(initProject)){
                    found = true;
                    loadProject(file);
                }
            }
            if (!found){
                System.out.println("Warning: No Local Project " + initProject + " found. No Project initialised");
            }
        }else{
            for (File file : files) {
                loadProject(file);
            }
        }
    }

    @Path("/status")
    @GET
    @Timed(name="status")
    @Operation(summary = "Returns status of current computation", description = "Reads the internal Task Manager for the status of current computations on the server")
    public Response getStatus(
            @Parameter(description = "identifier of project")
            @PathParam("project_id") String projectID
    ) {
        refreshProject(projectID);
        return ok(new Status(tasks.getProject(projectID), tasks.status()));
    }

    @Deprecated
    @Path("/create-project")
    @POST
    @Timed
    @Consumes(MediaType.MULTIPART_FORM_DATA)
    @Operation(summary = "Upload Files to Model Checker", description = "POST Model Files in Order to create a new Project. POST property files in order to add properties to compute")
    public Response uploadProject(
            @Parameter(description = "identifier of project")
            @PathParam("project_id") String projectID,
            @Parameter(description = "Model File to upload to project")
            @FormDataParam("model_file") InputStream modelInputStream,
            @FormDataParam("model_file") FormDataContentDisposition modelDetail,
            @Parameter(description = "Property File to upload to project")
            @FormDataParam("property_file") InputStream propInputStream,
            @FormDataParam("property_file") FormDataContentDisposition propDetail
    ) {

        String output = "";

        if(modelDetail != null) {
            if (new File(String.format("%s/%s", rootDir, projectID)).exists()){
                return Response.status(Response.Status.FORBIDDEN).entity("project already exists").build();
            }
            try {
                Files.createDirectory(Paths.get(String.format("%s/%s", rootDir, projectID)));
                createStyleFile(projectID);
                final String uploadModel = String.format("%s/%s/", rootDir, projectID) + Namespace.PROJECT_MODEL;
                writeToFile(modelInputStream, uploadModel);
                output += String.format("Model File uploaded to %s\n", uploadModel);
            } catch (IOException e) {
                return error(e);
            }
        }

        if (propDetail != null){
            final String uploadProp = String.format("%s/%s/", rootDir, projectID) + propDetail.getFileName();
            try {
                writeToFile(propInputStream, uploadProp);
            } catch (IOException e) {
                return error(e);
            }
            output += String.format("Property File uploaded to %s\n", uploadProp);
        } else if (modelDetail != null) {
            output += "Property File empty";
        }

        try {
            tasks.createProject(projectID);
        } catch (Exception e) {
            return error(e);
        }

        return Response.ok(output).build();
    }

    @Path("/upload-model")
    @POST
    @Timed
    @Consumes(MediaType.MULTIPART_FORM_DATA)
    @Operation(summary = "Upload Files to Model Checker", description = "POST Model Files in Order to create a new Project.")
    public Response uploadModel(
            @Parameter(description = "identifier of project")
            @PathParam("project_id") String projectID,
            @Parameter(description = "Model File to upload to project")
            @FormDataParam("file") InputStream modelInputStream,
            @FormDataParam("file") FormDataContentDisposition modelDetail
    ) {

        refreshProject(projectID);

        String output = "";

        //Create Project folder for a new Project
        if (!new File(String.format("%s/%s", rootDir, projectID)).exists()){
            try{Files.createDirectory(Paths.get(String.format("%s/%s", rootDir, projectID)));
                createStyleFile(projectID);
            } catch (IOException e) {
                return error(e);
            }
        }

        final String uploadModel = String.format("%s/%s/", rootDir, projectID) + Namespace.PROJECT_MODEL;

        //Check whether we overwrite the model file. Remove Project and delete file if this is the case.
        File modelFile = new File(uploadModel);
        boolean newProject = !modelFile.exists();

        try {
            //Write new File
            final String uploadModelTemp = String.format("%s/%s/temp_", rootDir, projectID) + Namespace.PROJECT_MODEL;
            writeToFile(modelInputStream, uploadModelTemp);

            File tempFile = new File(uploadModelTemp);

            String parsingMessage = tasks.checkParse(tempFile, configuration.getDebug());

            if(parsingMessage != null){
                System.out.println("parse Failed");
                tempFile.delete();
                return error("File could not be parsed: \n" + parsingMessage);
            }
            if (!newProject){
                modelFile.delete();
            }
            Files.move(tempFile.toPath(), modelFile.toPath());

            output += String.format("Model File uploaded to %s\n", uploadModel);

            if(newProject){
                tasks.createProject(projectID);
            }else{
                tasks.resetProject(projectID);
            }
        } catch (Exception e) {
            return error(e);
        }
        return Response.ok(output).build();
    }

    @Path("/upload-properties")
    @POST
    @Timed
    @Consumes(MediaType.MULTIPART_FORM_DATA)
    @Operation(summary = "Upload Files to Model Checker", description = "POST property files in order to add properties to compute")
    public Response uploadProperty(
            @Parameter(description = "identifier of project")
            @PathParam("project_id") String projectID,
            @Parameter(description = "Property File to upload to project")
            @FormDataParam("file") InputStream propInputStream,
            @FormDataParam("file") FormDataContentDisposition propDetail
    ) {

        refreshProject(projectID);

        if (!new File(String.format("%s/%s", rootDir, projectID)).exists()){
            return Response.status(Response.Status.FORBIDDEN).entity("Project does not exist. Please upload a model first.").build();
        }

        final String uploadProp = String.format("%s/%s/", rootDir, projectID) + propDetail.getFileName();

        //Check whether we overwrite the property file. Remove Project and delete file if this is the case.
        if(new File(uploadProp).delete()) {
            try {
                writeToFile(propInputStream, uploadProp);
                tasks.resetProject(projectID);
            } catch (Exception e) {
                return error(e);
            }
        }else{
            try {
                writeToFile(propInputStream, uploadProp);
                if (tasks.containsProject(projectID)) {
                    tasks.getProject(projectID).loadPropertyFile(new File(uploadProp));
                }else{
                    loadProject(projectID);
                }
            } catch (Exception e) {
                return error(e);
            }
        }
        return Response.ok(String.format("Property File uploaded to %s\n", uploadProp)).build();
    }

    @Path("/add-scheduler")
    @POST
    @Timed
    @Consumes(MediaType.MULTIPART_FORM_DATA)
    @Operation(summary = "Upload Files to Model Checker", description = "POST Model Files in Order to create a new Project. POST property files in order to add properties to compute")
    public Response uploadCustomScheduler(
            @Parameter(description = "identifier of project")
            @PathParam("project_id") String projectID,
            @Parameter(description = "Scheduler File to upload to project")
            @FormDataParam("scheduler_file") InputStream schedulerInputStream,
            @FormDataParam("scheduler_file") FormDataContentDisposition schedulerDetail
    ) {

        String output = "";

        if(schedulerDetail != null) {
            try {
                Project p = tasks.getProject(projectID);
                final String schedulerDescription = String.format("%s/%s/%s", rootDir, projectID, schedulerDetail.getFileName());
                writeToFile(schedulerInputStream, schedulerDescription);
                output += String.format("Scheduler File uploaded to %s\n", schedulerDescription);

                File schedulerFile = new File(schedulerDescription);
                p.addCustomScheduler(schedulerFile);

                Files.delete(schedulerFile.toPath());
            } catch (Exception e) {
                return error(e);
            }
        }else{
            output += "No file posted";
        }

        return Response.ok(output).build();
    }

    @Path("/remove-project")
    @GET
    @Timed
    @Operation(summary = "removes an existing project", description = "Removes all Modelfiles and Database Entries regarding the Project in question from the backend")
    public Response removeProject(
            @Parameter(description = "identifier of project")
            @PathParam("project_id") String projectID
    ){
        try {
            tasks.removeProject(projectID);

        } catch (Exception e) {
            if(debug){
                e.printStackTrace(System.out);
            }
            return error(e);
        }
        return ok(new Message(String.format("Project %s has been removed", projectID)));
    }

    @Path("/check")
    @GET
    @Timed
    @Operation(summary = "checks a property on the model", description = "Starts the Model Checking process for an already loaded property")
    public Response computeProperty(
            @Parameter(description = "identifier of project")
            @PathParam("project_id") String projectID,
            @Parameter(description = "properties that should be checked")
            @QueryParam("property") List<String> properties
    ){
        if (!tasks.containsProject(projectID)) {
            return error(String.format("Project %s does not exist", projectID));
        }

        Project p = tasks.getProject(projectID);

        for (String propertyName : properties) {
            try {
            p.getProperty(propertyName).ifPresent(property -> {
                try {
                    p.checkProperty(propertyName);
                    if (debug){
                        System.out.println("Checking property " + propertyName);
                    }
                } catch (PrismException e) {
                    throw new RuntimeException(e);
                }
            });
            } catch (Exception e) {
                return error(e);
            }

        }

        return ok(new Message(String.format("Started checking %s in project %s", String.join(", ", properties), projectID)));
    }

    @Path("/pane/all")
    @GET
    @Timed
    @Operation(summary = "returns list of all stored panes", description = "Reads the database for the ids of all stored panes")
    public Response panes(
            @Parameter(description = "identifier of project")
            @PathParam("project_id") String projectID
    ){
        try{
            return ok(tasks.getProject(projectID).storedPanes());
        } catch (Exception e) {
            return error(e);
        }
    }

    @Path("/pane/store")
    @POST
    @Consumes(MediaType.APPLICATION_JSON)
    @Timed
    @Operation(summary = "store a pane", description = "Stores all states in a pane in a dedicated database, allowing future retrieval")
    public Response storePane(
            @Parameter(description = "identifier of project")
            @PathParam("project_id") String projectID,
            @Parameter(description = "identifier of the pane")
            @QueryParam("pane_id") String paneID,
            @Parameter(description = "States contained in the Pane")
            String content
    ){
        try {
            if(content == null) {
                return error(new Message("No pane provided"));
            }
            tasks.getProject(projectID).storePane(paneID, content);
        } catch (Exception e) {
            return error(e);
        }
        return ok(new Message("Pane stored"));
    }

    @Path("/pane")
    @GET
    @Timed
    @Operation(summary = "store a pane", description = "Stores all states in a pane in a dedicated database, allowing future retrieval")
    public Response retrievePane(
            @Parameter(description = "identifier of project")
            @PathParam("project_id") String projectID,
            @Parameter(description = "identifier of the pane")
            @QueryParam("pane_id") List<String> paneID
    ){
        try {

            Pane p = tasks.getProject(projectID).retrievePanes(paneID);
            if(p == null) {
                return error(new Message("Could not find pane " + paneID));
            }
            return ok(p.getContent());
        } catch (Exception e) {
            return error(e);
        }
    }

    @Path("/clear")
    @GET
    @Timed
    @Operation(summary = "clears the database of the project", description = "Uncoppels the database from the project, deletes it, and creates a new database for the project. Stops all other tasks.")
    public Response computeProperty(
            @Parameter(description = "identifier of project")
            @PathParam("project_id") String projectID
    ){

        try {
            tasks.clearDatabase(projectID);
        } catch (Exception e) {
            System.out.print(e.getMessage());
            return error(e);
        }

        return ok(new Message(String.format("Cleared database for project %s", projectID)));
    }

    @Path("/projects")
    @GET
    @Operation(summary = "Returns all open projects", description = "Returns the ids of all currently stored projects")
    public Response getProjects(
            @Parameter(description = "identifier of project")
            @PathParam("project_id") String projectID
    ) {
        List<String> projectIDs = new ArrayList<>();

        for (File file : Objects.requireNonNull(new File(rootDir).listFiles())) {
            String fileName = file.getName();
            if (file.isDirectory()) {
                projectIDs.add(fileName);
            }
        }
        projectIDs.sort(String::compareTo);
        return ok(projectIDs);
    }
}
