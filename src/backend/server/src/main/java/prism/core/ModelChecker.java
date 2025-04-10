package prism.core;

import parser.ast.Expression;
import parser.ast.ModulesFile;
import parser.ast.PropertiesFile;
import prism.*;
import prism.api.VariableInfo;
import prism.core.Property.Property;
import prism.core.Utility.Prism.Updater;
import prism.core.Utility.Timer;
import prism.db.Batch;
import prism.db.Database;
import prism.server.Task;
import simulator.Choice;
import simulator.TransitionList;

import java.io.*;
import java.sql.SQLException;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.stream.Collectors;

public class ModelChecker implements Namespace {

    private final Project project;
    private final Prism prism;
    private final ModulesFile modulesFile;
    private prism.Model model;
    private final Updater updater;

    private final String stateTable;
    private final String transTable;

    private final String schedTable;

    public ModelChecker(Project project, File modelFile, String stateTable, String transTable, String schedTable, String cuddMaxMem, int numIterations, boolean debug) throws Exception {
        this.project = project;
        this.stateTable = stateTable;
        this.transTable = transTable;
        this.schedTable = schedTable;
        if (debug) this.prism = new Prism(new PrismPrintStreamLog(System.out));
        else this.prism = new Prism(new PrismDevNullLog());
        prism.setCUDDMaxMem(cuddMaxMem);
        prism.setEngine(1);
        prism.setMaxIters(numIterations);

        prism.initialise();
        prism.setStoreVector(true);

        try (prism.core.Utility.Timer parse = new prism.core.Utility.Timer("parsing project", project.getLog())) {
            ModulesFile modulesFile = prism.parseModelFile(modelFile, ModelType.MDP);
            prism.loadPRISMModel(modulesFile);
            this.modulesFile = modulesFile;
        } catch (FileNotFoundException e) {
            throw new Exception(e.getMessage());
        }
        this.updater = new Updater(modulesFile, prism);
    }

    @Deprecated
    public static void runProfeat(Project project, File profeatFile, File propertyFile, long cuddMaxMem, int numIterations, int numThreads, boolean debug) throws Exception {
        File modelDir = new File(profeatFile.getParentFile(), "parts");
        if (modelDir.exists())
            modelDir.delete();
        modelDir.mkdir();
        //Create single models for every family member
        try {

            Process process
                    = Runtime.getRuntime().exec(String.format("profeat %s -t -o %s/model.prism --one-by-one", profeatFile, modelDir));

            StringBuilder output = new StringBuilder();

            BufferedReader reader
                    = new BufferedReader(new InputStreamReader(
                    process.getInputStream()));

            String line;
            while ((line = reader.readLine()) != null) {
                output.append(line + "\n");
            }

            int exitVal = process.waitFor();
            if (exitVal == 0) {
                System.out.println(
                        "Translated ProFeat file to Prism files");
                System.out.println(output);
            } else
                throw new RuntimeException(String.format("Could not translate profeat file:\n%s", output));
        } catch (InterruptedException e) {
            throw new RuntimeException(e);
        } catch (IOException e) {
            throw new RuntimeException(e);
        }

        String cuddMem = String.format("%dm", cuddMaxMem / (numThreads * 2));

        //load every resulting model into its own modelchecker instance
        List<ModelChecker> instances = new ArrayList<>();
        int i = 0;
        for (File file : modelDir.listFiles()) {
            String stateTable = String.format("%s_%s", project.getStateTableName(), i);
            String transTable = String.format("%s_%s", project.getTransitionTableName(), i);
            String schedTable = String.format("%s_%s", project.getSchedulerTableName(), i);
            ModelChecker instance = new ModelChecker(project, file, stateTable, transTable, schedTable, cuddMem, numIterations, debug);
            instances.add(instance);
            i++;
        }

        //compute the familiy at parallel
        ExecutorService executorService = Executors.newFixedThreadPool(numThreads);
        List<CompletableFuture<Void>> futures = new ArrayList<>();
        for (ModelChecker instance : instances) {
            CompletableFuture<Void> future = CompletableFuture.runAsync(() -> {
                try {
                    instance.buildModel();
                    instance.parsePropertyFile(propertyFile.getPath());
                    instance.modelCheckAll();
                } catch (Exception e) {
                    throw new RuntimeException(e);
                }
            }, executorService);
            futures.add(future);
        }
        CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();
        executorService.shutdown();

        //Gather all results into database

    }

    public static File translateProFeat(File profeatFile, File targetFile) {
        try {
            Process process
                    = Runtime.getRuntime().exec(String.format("profeat %s -t -o %s", profeatFile.getPath(), targetFile.getPath()));

            StringBuilder output = new StringBuilder();

            BufferedReader reader
                    = new BufferedReader(new InputStreamReader(
                    process.getInputStream()));

            String line;
            while ((line = reader.readLine()) != null) {
                output.append(line + "\n");
            }

            int exitVal = process.waitFor();
            if (exitVal == 0) {
                System.out.println(
                        "Translated ProFeat file to Prism file");
                System.out.println(output);
                File existingFile = new File(targetFile.getPath());
                return existingFile;
            } else
                throw new RuntimeException(String.format("Could not translate profeat file:\n%s", output));
        } catch (InterruptedException e) {
            throw new RuntimeException(e);
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

    public Prism getPrism() {
        return this.prism;
    }

    public Updater getUpdater() {
        return this.updater;
    }

    public Model getModel() {
        return this.model;
    }

    public ModulesFile getModulesFile() {
        return this.modulesFile;
    }

    public boolean isBuilt() {
        return (project.getDatabase().question(String.format("SELECT name FROM sqlite_schema WHERE type='table' AND name='%s'", stateTable)) & project.getDatabase().question(String.format("SELECT name FROM sqlite_schema WHERE type='table' AND name='%s'", transTable)));
    }

    public void reset() throws Exception {
        this.model = null;
        Database database = project.getDatabase();

        database.execute(String.format("DROP TABLE IF EXISTS %s", stateTable));
        database.execute(String.format("DROP TABLE IF EXISTS %s", transTable));
        database.execute(String.format("DROP TABLE IF EXISTS %s", schedTable));

        project.setBuilt(false);
    }

    private class modelBuildTask implements Task {
        Database database;

        public modelBuildTask() {
            this.database = project.getDatabase();
        }

        @Override
        public void run() {
            try (prism.core.Utility.Timer build = new prism.core.Utility.Timer("Build Project", project.getLog())) {
                prism.buildModelIfRequired();
            } catch (Exception e) {
                throw new RuntimeException(e);
            }

            model = prism.getBuiltModel();
            if (model == null || isBuilt()) {
                project.setBuilt(true);
                return;
            }

//            try {
//                Debug.sleep(100000);
//            } catch (InterruptedException e) {
//                throw new RuntimeException(e);
//            }

            try (prism.core.Utility.Timer build = new Timer("Build Database", project.getLog())) {
                int numRewards = modulesFile.getNumRewardStructs();
                try {
                    database.execute(String.format("CREATE TABLE %s (%s INTEGER PRIMARY KEY NOT NULL, %s TEXT, %s BOOLEAN)", stateTable, ENTRY_S_ID, ENTRY_S_NAME, ENTRY_S_INIT));
                    database.execute(String.format("CREATE TABLE %s (%s INTEGER PRIMARY KEY NOT NULL, %s INTEGER NOT NULL, %s TEXT, %s INTEGER);", transTable, ENTRY_T_ID, ENTRY_T_OUT, ENTRY_T_ACT, ENTRY_T_PROB));
                    database.execute(String.format("CREATE TABLE %s (%s TEXT, %s TEXT)", schedTable, ENTRY_SCH_ID, ENTRY_SCH_NAME));

                    for (int i = 0; i < numRewards; i++) {
                        database.execute(String.format("ALTER TABLE %s ADD COLUMN %s TEXT", stateTable, ENTRY_REW + i));
                        database.execute(String.format("ALTER TABLE %s ADD COLUMN %s TEXT", transTable, ENTRY_REW + i));
                    }

                } catch (SQLException e) {
                    throw new RuntimeException(e.toString());
                }

                List<String> stateList = model.getReachableStates().exportToStringList();

                String stateInsertCall = String.format("INSERT INTO %s (%s,%s,%s) VALUES(?,?,?)", stateTable, ENTRY_S_ID, ENTRY_S_NAME, ENTRY_S_INIT);
                String transitionInsertCall = String.format("INSERT INTO %s(%s,%s,%s,%s) VALUES (?,?,?,?)", transTable, ENTRY_T_ID, ENTRY_T_OUT, ENTRY_T_ACT, ENTRY_T_PROB);
                if (numRewards > 0) {
                    String[] rewardHeader = new String[numRewards];
                    String[] questionHeader = new String[numRewards];
                    for (int i = 0; i < numRewards; i++) {
                        rewardHeader[i] = ENTRY_REW + i;
                        questionHeader[i] = "?";
                    }
                    stateInsertCall = String.format("INSERT INTO %s (%s,%s,%s,%s) VALUES(?,?,?,%s)", stateTable, ENTRY_S_ID, ENTRY_S_NAME, ENTRY_S_INIT, String.join(",", rewardHeader), String.join(",", questionHeader));
                    transitionInsertCall = String.format("INSERT INTO %s(%s,%s,%s,%s,%s) VALUES (?,?,?,?,%s)", transTable, ENTRY_T_ID, ENTRY_T_OUT, ENTRY_T_ACT, ENTRY_T_PROB, String.join(",", rewardHeader), String.join(",", questionHeader));
                }

                try (Batch toExecute = database.createBatch(stateInsertCall, 3 + numRewards)) {
                    for (int i = 0; i < stateList.size(); i++) {
                        String stateName = project.getModelParser().normalizeStateName(stateList.get(i));
                        parser.State s = project.getModelParser().parseState(stateName);
                        long s_id = project.getModelParser().stateIdentifier(s);

                        //Determine whether this is an initial state or not
                        Expression initialExpression = modulesFile.getInitialStates();
                        boolean initial;
                        if (initialExpression == null) {
                            initial = modulesFile.getDefaultInitialState().equals(s);
                        } else {
                            initial = initialExpression.evaluateBoolean(s);
                        }

                        //Create State in table
                        if (numRewards > 0) {
                            double[] rewards = new double[numRewards];
                            updater.calculateStateRewards(s, rewards);
                            String[] inputs = new String[numRewards + 3];
                            inputs[0] = Long.toString(s_id);
                            inputs[1] = stateName;
                            inputs[2] = initial ? "1" : "0";
                            for (int j = 0; j < numRewards; j++) {
                                inputs[j + 3] = String.valueOf(rewards[j]);
                            }
                            toExecute.addToBatch(inputs);
                        } else {
                            toExecute.addToBatch(Long.toString(s_id), stateName, initial ? "1" : "0");
                        }
                    }
                } catch (SQLException e) {
                    throw new RuntimeException(e);
                }

                try (Batch toExecute = database.createBatch(transitionInsertCall, 4 + numRewards)) {
                    for (int i = 0; i < stateList.size(); i++) {
                        String stateName = project.getModelParser().normalizeStateName(stateList.get(i));
                        parser.State s = project.getModelParser().parseState(stateName);
                        long s_id = project.getModelParser().stateIdentifier(s);

                        TransitionList<Double> transitionList = new TransitionList<>(Evaluator.forDouble());
                        updater.calculateTransitions(s, transitionList);
                        for (int j = 0; j < transitionList.getNumChoices(); j++) {
                            Choice<Double> choice = transitionList.getChoice(j);
                            String actionName = choice.getModuleOrAction();

                            long t_id = project.getModelParser().transitionIdentifier(s, choice);

                            Map<Long, Double> probabilities = new HashMap<>();

                            for (int l = 0; l < choice.size(); l++) {
                                double probability = choice.getProbability(l);
                                parser.State target = choice.computeTarget(l, s, modulesFile.createVarList());
                                probabilities.put(project.getModelParser().stateIdentifier(target), probability);
                            }
                            if (numRewards > 0) {
                                double[] rewards = new double[numRewards];
                                updater.calculateTransitionRewards(s, choice.getModuleOrActionIndex(), rewards);
                                String[] inputs = new String[numRewards + 4];
                                inputs[0] =  Long.toString(t_id);
                                inputs[1] =  Long.toString(s_id);
                                inputs[2] = actionName;
                                inputs[3] = probabilities.entrySet().stream().map(e -> String.format("%s:%s", e.getKey(), e.getValue())).collect(Collectors.joining(";"));
                                for (int l = 0; l < numRewards; l++) {
                                    inputs[l + 4] = String.valueOf(rewards[l]);
                                }
                                toExecute.addToBatch(inputs);
                            } else {
                                toExecute.addToBatch(Long.toString(t_id), Long.toString(s_id), actionName, probabilities.entrySet().stream().map(e -> String.format("%s:%s", e.getKey(), e.getValue())).collect(Collectors.joining(";")));
                            }
                        }
                    }
                } catch (SQLException e) {
                    throw new RuntimeException(e);
                }
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
            project.setBuilt(true);
        }

        @Override
        public String status() {
            return "Building Model of Project " + project.getID();
        }

        @Override
        public String name() {
            return "Building_" + project.getID();
        }

        @Override
        public Type type() {
            return Type.Build;
        }

        @Override
        public String projectID() {
            return project.getID();
        }
    }

    private class modelCheckTask implements Task {

        Property property;

        public modelCheckTask(Property property) {
            this.property = property;
        }

        public void run() {
            try {
                prism.buildModelIfRequired();
                VariableInfo newInfo = property.modelCheck();
                Map<String, VariableInfo> info = (Map<String, VariableInfo>) project.getInfo().getStateEntry(OUTPUT_RESULTS);
                info.replace(property.getName(), newInfo);
                project.getInfo().setStateEntry(OUTPUT_RESULTS, info);
                project.getInfo().setTransitionEntry(OUTPUT_RESULTS, info);
            } catch (PrismException e) {
                throw new RuntimeException(e);
            }
        }

        @Override
        public String status() {
            return "Checking " + property.getName() + " in Project " + project.getID();
        }

        @Override
        public String name() {
            return "Check_" + property.getName() + "_" + project.getID();
        }

        @Override
        public Type type() {
            return Type.Check;
        }

        @Override
        public String projectID() {
            return project.getID();
        }
    }

    public void buildModel() throws PrismException {
        //Check whether model has been build or is already queued to build
        if (this.model != null && this.isBuilt()) {
            return;
        }
        if (!project.getTaskManager().containsTask(Task.Type.Build, project.getID())) {
            project.getTaskManager().execute(new modelBuildTask());
        }
    }

    public void checkModel(String propertyName) throws PrismException {
        buildModel();

        Optional<Property> p = project.getProperty(propertyName);
        if(p.isPresent()) {
            Property property = p.get();
            Map<String, VariableInfo> info = (Map<String, VariableInfo>) project.getInfo().getStateEntry(OUTPUT_RESULTS);
            info.get(propertyName).setStatus(VariableInfo.Status.computing);
            project.getInfo().setStateEntry(OUTPUT_RESULTS, info);
            project.getInfo().setTransitionEntry(OUTPUT_RESULTS, info);
            project.getTaskManager().execute(new modelCheckTask(property));
        }
    }

    public void checkModelDirectly(String propertyName) throws PrismException {
        if (this.model == null || !this.isBuilt()) {
            new modelBuildTask().run();
        }

        Optional<Property> p = project.getProperty(propertyName);
        p.ifPresent(property -> new modelCheckTask(property).run());
    }

    public void parsePropertyFile(String path) throws Exception {
        PropertiesFile propertiesFile = prism.parsePropertiesFile(new File(path));

        if (propertiesFile == null) {
            propertiesFile = prism.parsePropertiesString("");
        }

        for (int i = 0; i < propertiesFile.getNumProperties(); i++) {
            project.newProperty(propertiesFile, i);
        }
    }

    public void modelCheckAll() throws PrismException {
        for (Property p : project.getProperties()) {
            checkModelDirectly(p.getName());
        }
    }

}