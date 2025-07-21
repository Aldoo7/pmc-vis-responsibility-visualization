package prism.server;

import io.dropwizard.Application;
import io.dropwizard.setup.Bootstrap;
import io.dropwizard.setup.Environment;
import io.swagger.v3.jaxrs2.integration.resources.OpenApiResource;
import org.eclipse.jetty.servlets.CrossOriginFilter;
import org.glassfish.jersey.media.multipart.MultiPartFeature;
import prism.cli.SchedulerConverter;
import prism.cli.StatisticalChecker;
import prism.resources.ModelResource;
import prism.resources.TaskResource;

import javax.servlet.DispatcherType;
import javax.servlet.FilterRegistration;
import java.util.EnumSet;

public class PRISMServerApplication extends Application<PRISMServerConfiguration> {

	public static void main(String[] args) throws Exception {

		new PRISMServerApplication().run(args);

	}

	@Override
	public String getName() {
		return "pmc-vis-backend";
	}

	@Override
	public void initialize(Bootstrap<PRISMServerConfiguration> bootstrap) {
		bootstrap.addCommand(new SchedulerConverter());
		bootstrap.addCommand(new StatisticalChecker());
	}

	@Override
	public void run(PRISMServerConfiguration configuration,
					Environment environment) throws Exception {

		System.out.println("Starting Backend Server");

		SocketServer sockets = new SocketServer(configuration);

		TaskManager activeProjects = new TaskManager(sockets);
		environment.lifecycle().manage(activeProjects);

		// Enable CORS headers
		final FilterRegistration.Dynamic cors =
				environment.servlets().addFilter("CORS", CrossOriginFilter.class);

		// Configure CORS parameters
		cors.setInitParameter("allowedOrigins", "*");
		cors.setInitParameter("allowedHeaders", "X-Requested-With,Content-Type,Accept,Origin");
		cors.setInitParameter("allowedMethods", "GET,POST");

		// Add URL mapping
		cors.addMappingForUrlPatterns(EnumSet.allOf(DispatcherType.class), true, "/*");

		final TaskResource taskResource = new TaskResource(
				environment, configuration, activeProjects
		);

		final ModelResource modelResource = new ModelResource(
				environment, configuration, activeProjects
		);

		environment.jersey().register(MultiPartFeature.class);
		environment.jersey().register(modelResource);
		environment.jersey().register(taskResource);

		environment.jersey().register(new OpenApiResource().configLocation("src/main/documentation/openapi.yaml"));

		System.out.println("Backend Server started");
		System.out.println("Server is listening on port http://localhost:8080");

	}


}
