package prism.core;

import parser.State;
import parser.ast.Expression;
import parser.ast.ExpressionReward;
import parser.ast.ModulesFile;
import parser.ast.PropertiesFile;
import prism.*;
import prism.core.Property.Property;
import prism.core.Scheduler.Scheduler;
import prism.core.Utility.Prism.MDStrategyDB;
import prism.core.Utility.Prism.Updater;
import prism.core.Utility.Timer;
import prism.db.Batch;
import prism.db.Database;
import prism.misc.Debug;
import prism.server.Task;
import simulator.Choice;
import simulator.SimulatorEngine;
import simulator.TransitionList;
import simulator.method.*;
import strat.StrategyGenerator;

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
    private final String resTable;

    public ModelChecker(Project project, File modelFile, String stateTable, String transTable, String schedTable, String resTable, String cuddMaxMem, int numIterations, boolean debug) throws Exception {
        this.project = project;
        this.stateTable = stateTable;
        this.transTable = transTable;
        this.schedTable = schedTable;
        this.resTable = resTable;
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
            String resTable = String.format("%s_%s", project.getInfoTableName(), i);
            ModelChecker instance = new ModelChecker(project, file, stateTable, transTable, schedTable, resTable, cuddMem, numIterations, debug);
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
                    instance.modelCheckingFromFile(propertyFile.getPath());
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
                    database.execute(String.format("CREATE TABLE %s (%s INTEGER PRIMARY KEY, %s INTEGER NOT NULL, %s TEXT, %s INTEGER);", transTable, ENTRY_T_ID, ENTRY_T_OUT, ENTRY_T_ACT, ENTRY_T_PROB));
                    database.execute(String.format("CREATE TABLE %s (%s TEXT, %s TEXT)", schedTable, ENTRY_SCH_ID, ENTRY_SCH_NAME));
                    database.execute(String.format("CREATE TABLE %s (%s TEXT, %s TEXT, %s TEXT)", resTable, ENTRY_R_ID, ENTRY_R_NAME, ENTRY_R_INFO));

                    for (int i = 0; i < numRewards; i++) {
                        database.execute(String.format("ALTER TABLE %s ADD COLUMN %s TEXT", stateTable, ENTRY_REW + i));
                        database.execute(String.format("ALTER TABLE %s ADD COLUMN %s TEXT", transTable, ENTRY_REW + i));
                    }

                } catch (SQLException e) {
                    throw new RuntimeException(e.toString());
                }

                List<String> stateList = model.getReachableStates().exportToStringList();
                Map<State, Integer> states = new HashMap<>();

                String stateInsertCall = String.format("INSERT INTO %s (%s,%s,%s) VALUES(?,?,?)", stateTable, ENTRY_S_ID, ENTRY_S_NAME, ENTRY_S_INIT);
                String transitionInsertCall = String.format("INSERT INTO %s(%s,%s,%s) VALUES (?,?,?)", transTable, ENTRY_T_OUT, ENTRY_T_ACT, ENTRY_T_PROB);
                if (numRewards > 0) {
                    String[] rewardHeader = new String[numRewards];
                    String[] questionHeader = new String[numRewards];
                    for (int i = 0; i < numRewards; i++) {
                        rewardHeader[i] = ENTRY_REW + i;
                        questionHeader[i] = "?";
                    }
                    stateInsertCall = String.format("INSERT INTO %s (%s,%s,%s,%s) VALUES(?,?,?,%s)", stateTable, ENTRY_S_ID, ENTRY_S_NAME, ENTRY_S_INIT, String.join(",", rewardHeader), String.join(",", questionHeader));
                    transitionInsertCall = String.format("INSERT INTO %s(%s,%s,%s,%s) VALUES (?,?,?,%s)", transTable, ENTRY_T_OUT, ENTRY_T_ACT, ENTRY_T_PROB, String.join(",", rewardHeader), String.join(",", questionHeader));
                }

                try (Batch toExecute = database.createBatch(stateInsertCall, 3 + numRewards)) {
                    for (int i = 0; i < stateList.size(); i++) {
                        String stateName = project.getModelParser().normalizeStateName(stateList.get(i));
                        parser.State s = project.getModelParser().parseState(stateName);

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
                            inputs[0] = Integer.toString(i);
                            inputs[1] = stateName;
                            inputs[2] = initial ? "1" : "0";
                            for (int j = 0; j < numRewards; j++) {
                                inputs[j + 3] = String.valueOf(rewards[j]);
                            }
                            toExecute.addToBatch(inputs);
                        } else {
                            toExecute.addToBatch(Integer.toString(i), stateName, initial ? "1" : "0");
                        }

                        states.put(s, i);
                    }
                } catch (SQLException e) {
                    throw new RuntimeException(e);
                }

                try (Batch toExecute = database.createBatch(transitionInsertCall, 3 + numRewards)) {
                    for (parser.State s : states.keySet()) {
                        TransitionList<Double> transitionList = new TransitionList<>(Evaluator.forDouble());
                        updater.calculateTransitions(s, transitionList);
                        for (int i = 0; i < transitionList.getNumChoices(); i++) {
                            Choice<Double> choice = transitionList.getChoice(i);
                            String actionName = choice.getModuleOrAction();

                            Map<Integer, Double> probabilities = new HashMap<>();

                            for (int j = 0; j < choice.size(); j++) {
                                double probability = choice.getProbability(j);
                                parser.State target = choice.computeTarget(j, s, modulesFile.createVarList());
                                probabilities.put(states.get(target), probability);
                            }
                            if (numRewards > 0) {
                                double[] rewards = new double[numRewards];
                                updater.calculateTransitionRewards(s, i, rewards);
                                String[] inputs = new String[numRewards + 3];
                                inputs[0] = String.valueOf(states.get(s));
                                inputs[1] = actionName;
                                inputs[2] = probabilities.entrySet().stream().map(e -> String.format("%s:%s", e.getKey(), e.getValue())).collect(Collectors.joining(";"));
                                for (int j = 0; j < numRewards; j++) {
                                    inputs[j + 3] = String.valueOf(rewards[j]);
                                }
                                toExecute.addToBatch(inputs);
                            } else {
                                toExecute.addToBatch(String.valueOf(states.get(s)), actionName, probabilities.entrySet().stream().map(e -> String.format("%s:%s", e.getKey(), e.getValue())).collect(Collectors.joining(";")));
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
    }

    private class modelCheckTask implements Task {

        Property property;

        public modelCheckTask(Property property) {
            this.property = property;
        }

        public void run() {
            try {
                property.modelCheck();
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
    }

    public void buildModel() throws PrismException {
        //Check whether model has been build or is already queued to build
        if (this.model != null && this.isBuilt()) {
            return;
        }
        if (!project.getTaskManager().containsTask(Task.Type.Build)) {
            project.getTaskManager().execute(new modelBuildTask());
        }
    }

    public TreeMap<String, String> checkModel(PropertiesFile propertiesFile) throws PrismException {
        buildModel();
        TreeMap<String, String> info = new TreeMap<>();

        //if (((NondetModel) prism.getBuiltModel()).areAllChoiceActionsUnique()){
        //    prism.setGenStrat(true);
        //}

        if (propertiesFile == null) {
            propertiesFile = prism.parsePropertiesString("");
        }

        for (int i = 0; i < propertiesFile.getNumProperties(); i++) {
            String name = project.newProperty(propertiesFile, i);
            Optional<Property> p = project.getProperty(name);
            if (p.isPresent()) {
                project.getTaskManager().execute(new modelCheckTask(p.get()));
            }
        }
        return info;
    }

    public TreeMap<String, String> modelCheckingFromFile(String path) throws Exception {
        PropertiesFile propertiesFile = prism.parsePropertiesFile(new File(path));
        return checkModel(propertiesFile);
    }

}