package prism.resources;

import com.codahale.metrics.annotation.Timed;
import io.dropwizard.setup.Environment;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import prism.api.Message;
import prism.core.Project;
import prism.core.View.ViewType;
import prism.server.PRISMServerConfiguration;
import prism.server.TaskManager;

import javax.ws.rs.*;
import javax.ws.rs.core.MediaType;
import javax.ws.rs.core.Response;
import java.util.*;


/**
 * Main Resource of the Application
 */
@Path("/{project_id}")
@Produces(MediaType.APPLICATION_JSON)
public class ModelResource extends Resource {

    public ModelResource(Environment environment, PRISMServerConfiguration configuration, TaskManager tasks){
        super(environment, configuration, tasks);
    }

    @GET
    @Timed
    @Operation(summary = "Returns entire graph")
    public Response createUpperGraph(
            @Parameter(description = "identifier of project")
            @PathParam("project_id") String projectID,
            @QueryParam("view") List<Integer> viewID
    ) {
        try{
            if (!tasks.containsProject(projectID)) return error(new Message(String.format("Project %s not found", projectID)));
            return ok(tasks.getProject(projectID).getGraph(viewID));
        } catch (Exception e) {
            return error(e);
        }
    }

    @Path("/node:{id}")
    @GET
    @Timed(name="node")
    @Operation(summary = "Returns single node", description = "Returns single Node Object with identifier 'id'")
    public Response getNode(
            @Parameter(description = "identifier of project")
            @PathParam("project_id") String projectID,
            @Parameter(description = "Identifier of target node", required = true)
            @PathParam("id") long nodeID
    ) {
        return ok(tasks.getProject(projectID).getState(nodeID));
    }

    @Path("/subgraph")
    @GET
    @Timed(name="subgraph")
    @Operation(summary = "Returns interconnected subgraph of all given nodes", description = "Returns single Node Object with identifier 'id'")
    public Response getSubGraph(
            @Parameter(description = "identifier of project") @PathParam("project_id") String projectID,
            @Parameter(description = "Identifier of target node", required = true) @QueryParam("id") List<Long> nodeIDs,
            @QueryParam("view") List<Integer> viewID
    ) {
        refreshProject(projectID);
        return ok(tasks.getProject(projectID).getSubGraph(nodeIDs, viewID));
    }

    @Path("/reset")
    @GET
    @Timed(name="subgraph")
    @Operation(summary = "Returns interconnected subgraph of all given nodes", description = "Returns single Node Object with identifier 'id'")
    public Response resetGraph(
            @Parameter(description = "identifier of project") @PathParam("project_id") String projectID,
            @Parameter(description = "Identifier of target node", required = true) @QueryParam("id") List<Long> nodeIDs,
            @Parameter(description = "Identifier of target node that is not explored", required = true) @QueryParam("idu") List<Long> unexploredNodeIDs,
            @QueryParam("view") List<Integer> viewID
    ) {
        return ok(tasks.getProject(projectID).resetGraph(nodeIDs, unexploredNodeIDs));
    }

    @Path("/outgoing")
    @GET
    @Timed(name="outgoing")
    @Operation(summary = "Returns all outgoing edges", description = "Returns all edges starting in state 'id'")
    public Response getOutgoing(
            @Parameter(description = "identifier of project") @PathParam("project_id") String projectID,
            @Parameter(description = "Identifier of target node", required = true) @QueryParam("id") List<Long> nodeIDs,
            @QueryParam("view") List<Integer> viewID
    ) {
        if (!tasks.containsProject(projectID)) return error(String.format("project %s not open", projectID));
        return ok(tasks.getProject(projectID).getOutgoing(nodeIDs, viewID));
    }

    @Path("/initial")
    @GET
    @Timed(name="initial")
    @Operation(summary = "Returns all initial nodes", description = "Returns all nodes that are marked as initial states")
    public Response getInitial(
            @Parameter(description = "identifier of project")
            @PathParam("project_id") String projectID,
            @QueryParam("view") List<Integer> viewID
    ) {
        refreshProject(projectID);
        return ok(tasks.getProject(projectID).getInitialNodes(viewID));
    }

    @Path("/view:{type}")
    @GET
    @Operation(summary = "Creates a views", description = "Creates a new view in the project")
    public Response createView(
            @Parameter(description = "identifier of project")
            @PathParam("project_id") String projectID,
            @PathParam("type") ViewType type,
            @QueryParam("param") List<String> parameters,
            @QueryParam("limit_expression") String expression,
            @QueryParam("limit_data") String data
    ) {
        try {
            tasks.getProject(projectID).createView(type, parameters);
            return ok("Created View");

        } catch (Exception e) {
            System.out.println(e.getCause());
            e.printStackTrace();
            return error(e);
        }
    }
}
