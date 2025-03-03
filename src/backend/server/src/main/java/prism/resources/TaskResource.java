package prism.resources;

import com.codahale.metrics.annotation.Timed;
import io.dropwizard.db.DataSourceFactory;
import io.dropwizard.jdbi3.JdbiFactory;
import io.dropwizard.setup.Environment;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import org.glassfish.jersey.media.multipart.FormDataContentDisposition;
import org.glassfish.jersey.media.multipart.FormDataParam;
import org.jdbi.v3.core.Jdbi;
import prism.api.Message;
import prism.core.Namespace;
import prism.core.Project;
import prism.db.Database;
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
import java.util.Arrays;
import java.util.Objects;

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

    private void loadProject(File file){
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

    @Path("@Path(/{project_id}/create-project")
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
            final JdbiFactory factory = new JdbiFactory();
            DataSourceFactory dbfactory = configuration.getDataSourceFactory();
            dbfactory.setUrl(String.format("jdbc:sqlite:%s/%s/%s", rootDir, projectID, Namespace.DATABASE_FILE));

            final Jdbi jdbi = factory.build(environment, dbfactory, projectID);
            Database database = new Database(jdbi, debug);
            tasks.createProject(projectID, environment, configuration);
        } catch (Exception e) {
            return error(e);
        }

        return Response.ok(output).build();
    }

    @Path("/{project_id}/add-scheduler")
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

    @Path("/remove-project:{project_id}")
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
}
