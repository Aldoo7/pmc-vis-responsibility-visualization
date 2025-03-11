package prism.cli;

import io.dropwizard.cli.ConfiguredCommand;
import io.dropwizard.client.JerseyClientBuilder;
import io.dropwizard.db.DataSourceFactory;
import io.dropwizard.jdbi3.JdbiFactory;
import io.dropwizard.setup.Bootstrap;
import io.dropwizard.setup.Environment;
import net.sourceforge.argparse4j.inf.Namespace;
import net.sourceforge.argparse4j.inf.Subparser;
import org.jdbi.v3.core.Jdbi;
import prism.core.Project;
import prism.db.Database;
import prism.server.PRISMServerConfiguration;
import prism.server.TaskManager;

import javax.ws.rs.client.Client;
import java.io.*;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Objects;
import java.util.Optional;

public class StatisticalChecker extends ConfiguredCommand<PRISMServerConfiguration> {

    public StatisticalChecker() {
        // The name of our command is "hello" and the description printed is
        // "Prints a greeting"
        super("simulator", "Starts Parallel Computation of ProFeat Initial States");
    }

    @Override
    public void configure(Subparser subparser) {
        super.configure(subparser);

        subparser.addArgument("-m", "--model")
                .dest("model")
                .type(String.class)
                .required(true)
                .help("The prism model");

        subparser.addArgument("-p", "--properties")
                .dest("properties")
                .type(String.class)
                .required(true)
                .help("The property file");

        subparser.addArgument("-o", "--out")
                .dest("out")
                .type(String.class)
                .required(true)
                .help("output path");

        subparser.addArgument("-l", "--length")
                .dest("maxPath")
                .type(Long.class)
                .required(true)
                .help("maximal path length");

        subparser.addArgument( "--method")
                .dest("simMethod")
                .type(String.class)
                .required(false)
                .help("simulation Method");

        subparser.addArgument("--parallel")
                .dest("parallel")
                .type(Boolean.class)
                .required(false)
                .setDefault(true)
                .help("all properties in parallel or back to back?");

        subparser.addArgument("-s", "--scheduler")
                .dest("scheduler")
                .type(String.class)
                .required(false)
                .help("custom scheduler used during simulation");
    }


    @Override
    protected void run(Bootstrap bootstrap, Namespace namespace, PRISMServerConfiguration configuration) throws Exception {
        final JdbiFactory factory = new JdbiFactory();
        DataSourceFactory dbfactory = configuration.getDataSourceFactory();
        String projectID = "temp";
        String rootDir = configuration.getPathTemplate();

        try{
            Files.createDirectory(Paths.get(String.format("%s/%s", rootDir, projectID)));
        }catch(FileAlreadyExistsException e){
            System.out.println("temp was not deleted");
            removeDir(new File(String.format("%s/%s", rootDir, projectID)));
            Files.createDirectory(Paths.get(String.format("%s/%s", rootDir, projectID)));
        }

        File model = new File(String.format("%s/%s/%s", rootDir, projectID, prism.core.Namespace.PROJECT_MODEL));
        File propertyFile = new File(String.format("%s/%s/%s", rootDir, projectID, "properties.props"));

        dbfactory.setUrl(String.format("jdbc:sqlite:%s/%s/%s", configuration.getPathTemplate(), projectID, prism.core.Namespace.DATABASE_FILE));
        //copy project
        copyFile(new File((String) namespace.get("model")), model);
        //copy properties
        copyFile(new File((String) namespace.get("properties")), propertyFile);

        final Jdbi jdbi = factory.build(new Environment("temp"), dbfactory, projectID);
        Database database = new Database(jdbi, configuration.getDebug());

        TaskManager taskManager = new TaskManager();

        Project project = new Project(projectID, configuration.getPathTemplate(), taskManager,  database, configuration.getCUDDMaxMem(), configuration.getIterations(), configuration.getDebug());

        Optional<String> scheduler;
        if (namespace.get("scheduler") == null){
            scheduler = Optional.empty();
        }else{
            String schedulerDescription = String.format("%s/%s/%s", rootDir, projectID, "scheduler.qry");
            File schedulerFile = new File(schedulerDescription);

            copyFile(new File((String) namespace.get("scheduler")), schedulerFile);

            project.addCustomScheduler(schedulerFile);
            scheduler = Optional.of(schedulerFile.getName());
            Files.delete(schedulerFile.toPath());
        }

        //project.modelCheckAllStatistical(namespace.getLong("maxPath"), namespace.get("simMethod"), namespace.getBoolean("parallel"), scheduler);
        project.removeFiles();
    }

    private void copyFile(File inFile, File outFile){
        try (
                InputStream in = new BufferedInputStream(
                        new FileInputStream(inFile));
                OutputStream out = new BufferedOutputStream(
                        new FileOutputStream(outFile))) {

            byte[] buffer = new byte[1024];
            int lengthRead;
            while ((lengthRead = in.read(buffer)) > 0) {
                out.write(buffer, 0, lengthRead);
                out.flush();
            }
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

    private void removeDir(File dir) throws Exception {
        if (dir.exists()) {
            for (File file : Objects.requireNonNull(dir.listFiles())) {
                if (file.isDirectory()){
                    removeDir(file);
                }else{
                    file.delete();
                }
            }
            dir.delete();
        }
    }
}
