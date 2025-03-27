package prism.core;


import parser.ast.Expression;
import parser.ast.ModulesFile;
import parser.ast.PropertiesFile;
import prism.*;
import prism.api.*;
import prism.core.Property.Property;
import prism.core.Scheduler.Criteria;
import prism.core.Scheduler.CriteriaSort;
import prism.core.Scheduler.Scheduler;
import prism.core.Utility.BaseState;
import prism.core.Utility.Prism.Updater;
import prism.core.mdpgraph.MdpGraph;
import prism.core.View.*;
import prism.db.Database;
import prism.db.mappers.PairMapper;
import prism.db.mappers.StateMapper;
import prism.db.mappers.TransitionMapper;
import prism.server.PRISMServerConfiguration;
import prism.server.TaskManager;
import simulator.TransitionList;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.nio.file.Files;
import java.util.*;
import java.util.regex.Matcher;
import java.util.stream.Collectors;


/**
 * Representation of the project on the backend side. Contains Structural Information, Project Checker Access and Database Connection
 */
public class Project implements Namespace{

    private final String id;

    private final ModulesFile modulesFile;

    //private final Prism prism;
    private final ModelChecker modelChecker;
    private final ModelParser modelParser;

    private final TaskManager taskManager;

    private final Database database;
    //Name of the associated table for states in the database
    private final String TABLE_STATES;
    //Name of the associated table for transitions in the database
    private final String TABLE_TRANS;

    private final String TABLE_SCHED;

    public final boolean debug;
    private final String rootDir;

    private final TreeMap<String, Object> info;

    //List of properties that have been project checked
    private final List<Property> properties;

    private List<View> views; // Martin: removed final

    private boolean clearViewsOnStartup = true;

    private final List<Scheduler> schedulers;

    private final Map<String, AP> APs;

    private MdpGraph mdpGraph = null;
    private final File outLog;

    private boolean built = false;

    public Project(String id, String rootDir, TaskManager taskManager, Database database, PRISMServerConfiguration config) throws Exception {
        this(id, rootDir, taskManager, database, config.getCUDDMaxMem(), config.getIterations(), config.getDebug());
    }

    public Project(String id, String rootDir, TaskManager taskManager, Database database, long cuddMaxMem, int numIterations, boolean debug) throws Exception {
        this.id = id;
        this.taskManager = taskManager;
        this.debug = debug;
        this.rootDir = rootDir;
        this.info = new TreeMap<>();

        File file = new File(String.format("%s/%s/", rootDir, id) + PROJECT_MODEL);
        if (!file.exists()) {
            File profeatFile = new File(String.format("%s/%s/", rootDir, id) + PROFEAT_MODEL);
            if (!profeatFile.exists())
                throw new Exception("Project File does not exist");
            file = ModelChecker.translateProFeat(profeatFile, file);
        }

        outLog =  new File(String.format("%s/%s/", rootDir, id) + LOG_FILE);
        Files.deleteIfExists(outLog.toPath());

        TABLE_STATES = String.format(TABLE_STATES_GEN, 0);
        TABLE_TRANS = String.format(TABLE_TRANS_GEN, 0);
        TABLE_SCHED = String.format(TABLE_SCHED_GEN, 0);

        this.modelChecker = new ModelChecker(this, file, TABLE_STATES, TABLE_TRANS, TABLE_SCHED, String.format("%dm", cuddMaxMem), numIterations, debug);
        this.modulesFile = modelChecker.getModulesFile();
        this.modelParser = new ModelParser(this, modulesFile, debug);

        this.database = database;

        this.properties = new ArrayList<>();
        this.views = new ArrayList<>();
        this.schedulers = new ArrayList<>();

        this.APs = new HashMap<>();
        Map<String, Integer> usedShorts = new HashMap<>();
        Map<String, String> labelStyles = new HashMap<>();
        File styleFile = new File(String.format("%s/%s/", rootDir, id) + STYLE_FILE);
        if (styleFile.exists() && styleFile.isFile() ){
            try(BufferedReader read = new BufferedReader(new FileReader(styleFile))){
                labelStyles = read.lines().collect(Collectors.toMap(l -> l.split(":")[0], l -> l.split(":")[1]));
            }
        }

        AP initial;
        if (labelStyles.containsKey(LABEL_INIT)){
            initial = new AP(labelStyles.get(LABEL_INIT),true);
        }else{
            initial = new AP("i", false);
        }
        APs.put(LABEL_INIT,  initial);

        AP deadlock;
        if (labelStyles.containsKey(LABEL_DEAD)){
            deadlock = new AP(labelStyles.get(LABEL_DEAD),true);
        }else{
            deadlock = new AP("d", false);
        }
        APs.put(LABEL_DEAD,  deadlock);

        for (int i = 0; i < modulesFile.getNumLabels(); i++){
            String name = modulesFile.getLabelName(i);
            AP ap;
            if (labelStyles.containsKey(name)){
                ap = new AP(labelStyles.get(name),true);
            }else{
                String shortName = name.substring(0, 1);
                if (!usedShorts.containsKey(shortName)) usedShorts.put(shortName, 0);
                int number = usedShorts.get(shortName);
                ap = new AP(shortName + number, false);
                usedShorts.replace(shortName, number + 1);
            }
            APs.put(name,  ap);
        }
        info.put("ID", id);
        info.put(OUTPUT_LABELS, APs);

        info.put(OUTPUT_RESULTS, new TreeMap<>());

        this.loadPropertyFiles();
        this.loadDBInfo();

        makeViewDbAndViewInternalConsistent();

        if (clearViewsOnStartup) clearViews();

        //System.out.printf("Project %s opened\n", id);
        if (debug){
            System.out.println("----------Times----------");
            try (BufferedReader br = new BufferedReader(new FileReader(outLog))) {
                String line;
                while ((line = br.readLine()) != null) {
                    System.out.println(line);
                }
            }
            System.out.println("-----------End-----------");
        }
    }

    public TaskManager getTaskManager() {
        return taskManager;
    }

    public boolean isBuilt() {
        return this.built;
    }

    public void setBuilt(boolean built) {
        this.built = built;
    }

    public void putInfo(String category, Object newEntry) {
        info.put(category, newEntry);
    }

    public Object getInfo(String category) {
        return info.get(category);
    }

    public void addCustomScheduler(File description) throws Exception {
        List<Criteria> criterias = new ArrayList<>();
        //Create Criteria List by reading the file

        try(BufferedReader r = new BufferedReader(new FileReader(description))){
            while(r.ready()){
                String line = r.readLine();
                if (line == null){
                    break;
                }
                Matcher m = Criteria.CriteriaPattern.matcher(line);
                if (m.matches()){
                    switch (m.group(1)){
                        case "SORT":
                        default:
                            Optional<Property> p = this.getProperty(m.group(2));
                            if(p.isEmpty()) {
                                throw new Exception(m.group(2) + " not a checked property");
                            }
                            String collumnName = p.get().getPropertyCollumn();
                            if (m.group(3).equals(" ASC"))
                                criterias.add(new CriteriaSort(collumnName, CriteriaSort.Direction.ASC));
                            else
                                criterias.add(new CriteriaSort(collumnName, CriteriaSort.Direction.DESC));
                    }
                }
            }

        }

        Scheduler custom = Scheduler.createScheduler(this, description.getName(), schedulers.size(), criterias);
        this.schedulers.add(custom);
    }

    public void addScheduler(Scheduler scheduler){
        schedulers.add(scheduler);
    }

    public void printScheduler(String pathName, boolean limit) throws Exception {
        modelChecker.modelCheckAll();
        int i = 0;
        for (Property p : properties){
            p.printScheduler(String.format("%s/sched_%s.csv", pathName, i), limit);
            i++;
        }
    }

    //Generic Getter
    public String getID() {
        return id;
    }

    public ModulesFile getModulesFile() {
        return modulesFile;
    }

    public String getPath() {
        return this.rootDir;
    }

    public Updater getUpdater() {
        return modelChecker.getUpdater();
    }

    public Prism getPrism() {
        return this.modelChecker.getPrism();
    }

    public Database getDatabase() {
        return this.database;
    }

    // internal functionality
    public String getStateTableName() {
        return TABLE_STATES;
    }

    public String getTransitionTableName() {
        return TABLE_TRANS;
    }

    public MdpGraph getMdpGraph() {
        return mdpGraph;
    }

    public ModelParser getModelParser() {
        return modelParser;
    }

    public void buildMdpGraph() {
        this.mdpGraph = new MdpGraph(this);
    }

    public boolean existsProperty(String name) {
        return properties.stream().anyMatch(p -> p.getName().equals(name));
    }

    public Optional<Property> getProperty(String name) {
        return properties.stream().filter(p -> p.getName().equals(name)).findFirst();
    }

    public String newProperty(PropertiesFile propertiesFile, int number) {
        parser.ast.Property prismProperty = propertiesFile.getPropertyObject(number);
        String name = prismProperty.getName() != null ? prismProperty.getName() : prismProperty.getExpression().toString();
        if (existsProperty(name)) return name;
        properties.add(Property.createProperty(this, properties.size(), propertiesFile, prismProperty));
        return name;
    }

    // access to Structural Information

    public Long getDefaultInitialState() throws Exception {
        if (modulesFile.getInitialStates() != null) {
            return getInitialStates().get(0);
        }
        return getStateID(modulesFile.getDefaultInitialState().toString(this.modulesFile));
    }


    /**
     *
     * @return List of stateIDs
     * @throws Exception
     */
    public List<Long> getInitialStates() throws Exception {
        List<Long> initials = new ArrayList<>();

        if (modulesFile.getInitialStates() != null) {
            Expression initialExpression = modulesFile.getInitialStates();
            for (parser.State state : modulesFile.createVarList().getAllStates()) {
                if (initialExpression.evaluateBoolean(state)) {
                    initials.add(getStateID(state.toString(modulesFile)));
                }
            }
        } else {
            initials.add(this.getDefaultInitialState());
        }

        return initials;
    }

    public List<Long> getStatesByExpression(String expression) {
        List<Long> members = new ArrayList<>();
        if (modulesFile.getLabelList().getLabelNames().contains(expression)) {
            for (String stateDescription : this.modelChecker.getModel().getReachableStates().exportToStringList()) {
                try {
                    long id = this.getStateID(stateDescription);
                    BaseState state = new BaseState(id, stateDescription, this);
                    if (state.getLabels().contains(expression)) {
                        members.add(id);
                    }
                } catch (Exception e) {
                    throw new RuntimeException(e);
                }
            }
            return members;
        }
        for (String stateDescription : this.modelChecker.getModel().getReachableStates().exportToStringList()) {
            try {
                long id = this.getStateID(stateDescription);
                BaseState state = new BaseState(id, stateDescription, this);
                if (state.checkForProperty(expression)) {
                    members.add(id);
                }
            } catch (prism.PrismLangException e) {
                throw new RuntimeException(e);
            }
        }
        return members;
    }

    // access to Model Checker

    public void buildModel() throws PrismException {
        modelChecker.buildModel();
    }

    public void checkProperty(String propertyName) throws PrismException {
        modelChecker.checkModel(propertyName);
    }

    public void loadPropertyFiles() throws Exception {
        boolean fileForModelCheckingFound = false;
        for (File file : Objects.requireNonNull(new File(String.format("%s/%s", rootDir, id)).listFiles())) {
            if (!Namespace.FILES_RESERVED.contains(file.getName())) {
                fileForModelCheckingFound = true;
                if (this.debug) {
                    System.out.println("Model Checking File: " + file);
                }
                modelChecker.parsePropertyFile(file.getPath());
            }
        }
        if (this.debug && !fileForModelCheckingFound) {
            System.out.println("ERROR: No File for Model Checking found!");
        }
        if (this.debug) {
            System.out.printf("Loading Properties in Project %s finished%n", id);
        }
    }

    public void loadDBInfo(){
        if (modelChecker.isBuilt()) {
            this.setBuilt(true);
        }
    }

//    public TreeMap<String, String> modelCheckAllStatistical(long maxPathLength, String simulationMethod, boolean parallel, Optional<String> schedulerName) throws Exception {
//        TreeMap<String, String> info = new TreeMap<>();
//
//        Optional<Scheduler> scheduler = Optional.empty();
//        //Find scheduler
//        if (schedulerName.isPresent()){
//            for (Scheduler sched : schedulers){
//                if (sched.getName().equals(schedulerName.get())){
//                    scheduler = Optional.of(sched);
//                    break;
//                }
//            }
//            if (scheduler.isEmpty()){
//                System.out.println("Could not find scheduler " + schedulerName.get());
//            }
//        }
//
//        for (File file : Objects.requireNonNull(new File(String.format("%s/%s", rootDir, id)).listFiles())) {
//            if (!Namespace.FILES_RESERVED.contains(file.getName())) {
//                //Match simulation Method
//                List<Result[]> r = modelParser.modelCheckSimulator(file, null, maxPathLength, simulationMethod, parallel, scheduler);
//                StringBuilder out = new StringBuilder();
//
//                //for (int i = 0; i < r.length; i++){
//                //    out.append("-----------------------");
//                //    out.append(r.toString());
//                //}
//
//                //info.put(file.getName(), out.toString());
//            }
//        }
//        if (this.debug) {
//            System.out.printf("Statistical Model Checking in Project %s finished%n", id);
//        }
//        return info;
//    }

    // access to database

    public long getStateID(String stateDescription) {
        String stateName = modelParser.normalizeStateName(stateDescription);
        Optional<Long> results = database.executeLookupQuery(String.format("SELECT %s FROM %s WHERE %s = '%s';", ENTRY_S_ID, TABLE_STATES, ENTRY_S_NAME, stateName), Long.class);
        if (results.isEmpty()) return -1;
        return results.get();
    }

    public String getStateName(long stateID) {
        Optional<String> results = database.executeLookupQuery(String.format("SELECT %s FROM %s WHERE %s = '%s';", ENTRY_S_NAME, TABLE_STATES, ENTRY_S_ID, stateID), String.class);
        if (results.isEmpty()) return null;
        return results.get();
    }

    /**
     *
     * @return List of stateIDs of all States
     */
    public List<Long> getAllStates() {
        return database.executeCollectionQuery(String.format("SELECT %s FROM %s", ENTRY_S_ID, TABLE_STATES), Long.class);
    }

    /**
     *
     * @param stateIDs List of stateIDs (e.g. generated by getAllStates()
     * @return List of actual state objects
     */
    public List<State> getStates(List<Long> stateIDs) {
        String stateString = stateIDs.stream().map(l -> Long.toString(l)).collect(Collectors.joining(","));
        return database.executeCollectionQuery(String.format("SELECT * FROM %s WHERE %s in (%s)", TABLE_STATES, ENTRY_S_ID, stateString), new StateMapper(this, null));
    }

    /**
     *
     * @param stateID is ID of state
     * @return List of IDs of transitions
     */
    public List<Transition> getOutgoingList(long stateID) {
        return database.executeCollectionQuery(String.format("SELECT * FROM %s WHERE %s == %s ", TABLE_TRANS, ENTRY_T_OUT, stateID), new TransitionMapper(this));

    }

    /*
    public List<Transition> getIncomingList(long stateID) {
        return database.executeCollectionQuery(String.format("SELECT *, GROUP_CONCAT(%s || ':' || %s, ';') as %s FROM %s WHERE %s == %s GROUP BY %s, %s",ENTRY_T_IN, ENTRY_T_PROB, ENTRY_T_MAP, TABLE_TRANS, ENTRY_T_IN, stateID, ENTRY_T_OUT, ENTRY_T_ACT), new TransitionMapper());
    }*/

    public List<Transition> getAllTransitions() {
        return database.executeCollectionQuery(String.format("SELECT * FROM %s", TABLE_TRANS), new TransitionMapper(this));
    }

    // Output Functions
    public Graph getInitialNodes() {
        if (!built){
            try {
                return modelParser.getInitialNodes();
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        }
        try {
            List<State> initials = database.executeCollectionQuery(String.format("SELECT * FROM %s WHERE %s = 1", TABLE_STATES, ENTRY_S_INIT), new StateMapper(this, null));

            return new Graph(this, initials, new ArrayList<>());
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    public Graph getInitialNodes(List<Integer> viewIDs) {
        List<View> activeViews = this.getViews(viewIDs);
        if (views == null || views.isEmpty() || activeViews.isEmpty()) return this.getInitialNodes();
        try {
            StringBuilder identifierStates = null;
            StringBuilder groupStates = null;
            StringBuilder blankStates = null;
            for (View c : activeViews){
                if (identifierStates == null){
                    identifierStates = new StringBuilder();
                    groupStates = new StringBuilder();
                    blankStates = new StringBuilder();
                }else{
                    identifierStates.append(" || '" + C_CONCAT_SYMBOL + "' || ");
                    groupStates.append(", ");
                    blankStates.append(" AND ");
                }
                identifierStates.append(c.getCollumn());
                groupStates.append(c.getCollumn());
                blankStates.append(String.format("%s = '%s'", c.getCollumn(), Namespace.ENTRY_C_BLANK));
            }

            identifierStates.append(String.format("|| CASE WHEN %s THEN %s ELSE '+' END", blankStates.toString(), ENTRY_S_ID));
            groupStates.append(String.format(", CASE WHEN %s THEN %s ELSE 1 END", blankStates.toString(), ENTRY_S_ID));

            List<State> initials = database.executeCollectionQuery(String.format("SELECT %s as %s, GROUP_CONCAT(%s,';') AS %s FROM %s WHERE %s = 1 GROUP BY %s", identifierStates.toString(), ENTRY_C_NAME, ENTRY_S_ID, ENTRY_C_SUB, TABLE_STATES, ENTRY_S_INIT, groupStates.toString()), new StateMapper(this, activeViews));

            return new Graph(this, initials, new ArrayList<>());
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    public Graph getGraph() {
        if (!built) {
            try {
                return modelParser.getGetGraph();
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        }
        List<State> states = database.executeCollectionQuery(String.format("SELECT * FROM %s", TABLE_STATES), new StateMapper(this, null));
        List<Transition> transitions = database.executeCollectionQuery(String.format("SELECT * FROM %s", TABLE_TRANS), new TransitionMapper(this));
        return new Graph(this, states, transitions);
    }

    public Graph getGraph(List<Integer> viewIDs) {
        List<View> activeViews = this.getViews(viewIDs);
        if (views == null || views.isEmpty() || activeViews.isEmpty()) return this.getGraph();
        try {
            StringBuilder identifierStates = null;
            StringBuilder groupStates = null;
            StringBuilder blankStates = null;
            for (View c : activeViews){
                if (identifierStates == null){
                    identifierStates = new StringBuilder();
                    groupStates = new StringBuilder();
                    blankStates = new StringBuilder();
                }else{
                    identifierStates.append(" || '" + C_CONCAT_SYMBOL + "' || ");
                    groupStates.append(", ");
                    blankStates.append(" AND ");
                }
                identifierStates.append(c.getCollumn());
                groupStates.append(c.getCollumn());
                blankStates.append(String.format("%s = '%s'", c.getCollumn(), Namespace.ENTRY_C_BLANK));
            }

            identifierStates.append(String.format("|| CASE WHEN %s THEN %s ELSE '' END", blankStates.toString(), ENTRY_S_ID));
            groupStates.append(String.format(", CASE WHEN %s THEN %s ELSE 1 END", blankStates.toString(), ENTRY_S_ID));

            List<State> states = database.executeCollectionQuery(String.format("SELECT %s as %s, GROUP_CONCAT(%s,';') AS %s FROM %s GROUP BY %s", identifierStates, ENTRY_C_NAME, ENTRY_S_ID, ENTRY_C_SUB, TABLE_STATES, groupStates), new StateMapper(this, activeViews));

            Map<Long, String> reverseView = database.executeCollectionQuery(String.format("SELECT %s, %s AS %s FROM %s", ENTRY_S_ID, identifierStates, ENTRY_C_NAME, TABLE_STATES), new PairMapper<>(ENTRY_S_ID, ENTRY_C_NAME, Long.class, String.class)).stream().collect(Collectors.toMap(Pair::getKey, Pair::getValue));

            List<Transition> transitions = database.executeCollectionQuery(String.format("SELECT min(%s) AS %s, %s AS %s, %s, GROUP_CONCAT(%s,';') AS %s FROM %s JOIN %s ON %s = %s GROUP BY %s, %s", ENTRY_T_ID, ENTRY_T_ID, identifierStates, ENTRY_T_OUT, ENTRY_T_ACT, ENTRY_T_PROB, ENTRY_T_PROB, TABLE_TRANS, TABLE_STATES, ENTRY_S_ID, ENTRY_T_OUT, groupStates, ENTRY_T_ACT), new TransitionMapper(this, activeViews, reverseView));
            return new Graph(this, states, transitions);
        }catch (Exception e){
            throw new RuntimeException(e);
        }
    }

    public Graph getSubGraph(List<Long> stateIDs) {
        if (!built) {
            try {
                return modelParser.getSubGraph(stateIDs);
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        }
        List<String> stringIds = stateIDs.stream().map(l -> Long.toString(l)).collect(Collectors.toList());
        String stateID = stateIDs.stream().map(l -> Long.toString(l)).collect(Collectors.joining(","));
        List<State> states = database.executeCollectionQuery(String.format("SELECT * FROM %s WHERE %s in (%s)", TABLE_STATES, ENTRY_S_ID, stateID) , new StateMapper(this, null));
        List<Transition> transitions = database.executeCollectionQuery(String.format("SELECT * FROM %s WHERE %s IN (%s)", TABLE_TRANS, ENTRY_T_OUT, stateID), new TransitionMapper(this));
        List<Transition> transitionsOut = new ArrayList<>();
        for (Transition t : transitions){
            Set<String> reach = new HashSet<>(t.getProbabilityDistribution().keySet());
            stringIds.forEach(reach::remove);
            if (reach.isEmpty()){
                transitionsOut.add(t);
            }
        }
        return new Graph(this, states, transitionsOut);
    }

    public Graph getSubGraph(List<Long> stateIDs, List<Integer> viewIDs) {
        List<View> activeViews = this.getViews(viewIDs);
        if (views == null || views.isEmpty() || activeViews.isEmpty()) return this.getSubGraph(stateIDs);

        try {
            StringBuilder identifierStates = null;
            StringBuilder groupStates = null;
            StringBuilder blankStates = null;
            for (View c : activeViews){
                if (identifierStates == null){
                    identifierStates = new StringBuilder();
                    groupStates = new StringBuilder();
                    blankStates = new StringBuilder();
                }else{
                    identifierStates.append(" || '" + C_CONCAT_SYMBOL + "' || ");
                    groupStates.append(", ");
                    blankStates.append(" AND ");
                }
                identifierStates.append(c.getCollumn());
                groupStates.append(c.getCollumn());
                blankStates.append(String.format("%s = '%s'", c.getCollumn(), Namespace.ENTRY_C_BLANK));
            }

            identifierStates.append(String.format("|| CASE WHEN %s THEN %s ELSE '' END", blankStates.toString(), ENTRY_S_ID));
            groupStates.append(String.format(", CASE WHEN %s THEN %s ELSE 1 END", blankStates.toString(), ENTRY_S_ID));

            String stateID = stateIDs.stream().map(l -> Long.toString(l)).collect(Collectors.joining(","));

            List<State> states = database.executeCollectionQuery(String.format("SELECT %s as %s, GROUP_CONCAT(%s,';') AS %s FROM %s GROUP BY %s", identifierStates, ENTRY_C_NAME, ENTRY_S_ID, ENTRY_C_SUB, TABLE_STATES, groupStates), new StateMapper(this, activeViews));
            Set<String> stringIDs = states.stream().map(State::getId).collect(Collectors.toSet());
            Map<Long, String> reverseView = database.executeCollectionQuery(String.format("SELECT %s, %s AS %s FROM %s", ENTRY_S_ID, identifierStates, ENTRY_C_NAME, TABLE_STATES), new PairMapper<>(ENTRY_S_ID, ENTRY_C_NAME, Long.class, String.class)).stream().collect(Collectors.toMap(Pair::getKey, Pair::getValue));

            List<Transition> transitions = database.executeCollectionQuery(String.format("SELECT min(%s) AS %s, %s AS %s, %s, GROUP_CONCAT(%s,';') AS %s FROM %s JOIN %s ON %s = %s WHERE %s IN (%s) GROUP BY %s, %s", ENTRY_T_ID, ENTRY_T_ID, identifierStates, ENTRY_T_OUT, ENTRY_T_ACT, ENTRY_T_PROB, ENTRY_T_PROB , TABLE_TRANS, TABLE_STATES, ENTRY_S_ID, ENTRY_T_OUT ,ENTRY_T_OUT, stateID, groupStates, ENTRY_T_ACT), new TransitionMapper(this, activeViews, reverseView));
            List<Transition> transitionsOut = new ArrayList<>();
            for (Transition t : transitions){
                Set<String> reach = new HashSet<>(t.getProbabilityDistribution().keySet());
                stringIDs.forEach(reach::remove);
                if (reach.isEmpty()){
                    transitionsOut.add(t);
                }
            }

            return new Graph(this, states, transitionsOut);
        }catch (Exception e){
            throw new RuntimeException(e);
        }
    }

    public Graph getState(long stateID) {
        if (!built) {
            try {
                List<Long> stateIDs = new ArrayList<>();
                stateIDs.add(stateID);
                return modelParser.getSubGraph(stateIDs);
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        }
        Optional<State> results = database.executeLookupQuery(String.format("SELECT * FROM %s WHERE %s = %s", TABLE_STATES, ENTRY_S_ID, stateID), new StateMapper(this, null));
        if (results.isEmpty()) return null;
        List<State> states = new ArrayList<>();
        states.add(results.get());
        return new Graph(this, states, new ArrayList<>());
    }

    public Graph getOutgoing(List<Long> stateIDs) {
        if (!built) {
            try {
                return modelParser.getOutgoing(stateIDs);
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        }
        String stateID = stateIDs.stream().map(l -> Long.toString(l)).collect(Collectors.joining(","));
        List<Transition> transitions = database.executeCollectionQuery(String.format("SELECT * FROM %s WHERE %s IN (%s)", TABLE_TRANS, ENTRY_T_OUT, stateID), new TransitionMapper(this));
        Set<String> statesOfInterest = new HashSet<>();
        for (Transition t : transitions) {
            statesOfInterest.add(t.getSource());
            statesOfInterest.addAll(new ArrayList<>(t.getProbabilityDistribution().keySet()));
        }
        String stateString = String.join(",", statesOfInterest);
        List<State> states = database.executeCollectionQuery(String.format("SELECT * FROM %s WHERE %s in (%s)", TABLE_STATES, ENTRY_S_ID, stateString), new StateMapper(this, null));
        return new Graph(this, states, transitions);
    }

    public Graph getOutgoing(List<Long> stateIDs, List<Integer> viewIDs) {
        List<View> activeViews = this.getViews(viewIDs);
        if (views == null || views.isEmpty() || activeViews.isEmpty()) return this.getOutgoing(stateIDs);

        try{
            StringBuilder identifierStates = null;
            StringBuilder groupStates = null;
            StringBuilder blankStates = null;
            for (View c : activeViews){
                if (identifierStates == null){
                    identifierStates = new StringBuilder();
                    groupStates = new StringBuilder();
                    blankStates = new StringBuilder();
                }else{
                    identifierStates.append(" || '" + C_CONCAT_SYMBOL + "' || ");
                    groupStates.append(", ");
                    blankStates.append(" AND ");
                }
                identifierStates.append(c.getCollumn());
                groupStates.append(c.getCollumn());
                blankStates.append(String.format("%s = '%s'", c.getCollumn(), Namespace.ENTRY_C_BLANK));
            }

            identifierStates.append(String.format("|| CASE WHEN %s THEN %s ELSE '' END", blankStates.toString(), ENTRY_S_ID));
            groupStates.append(String.format(", CASE WHEN %s THEN %s ELSE 1 END", blankStates.toString(), ENTRY_S_ID));

            Map<Long, String> reverseView = database.executeCollectionQuery(String.format("SELECT %s, %s AS %s FROM %s", ENTRY_S_ID, identifierStates, ENTRY_C_NAME, TABLE_STATES), new PairMapper<>(ENTRY_S_ID, ENTRY_C_NAME, Long.class, String.class)).stream().collect(Collectors.toMap(Pair::getKey, Pair::getValue));

            String stateID = stateIDs.stream().map(l -> Long.toString(l)).collect(Collectors.joining(","));

            List<Transition> transitions = database.executeCollectionQuery(String.format("SELECT min(%s) AS %s, %s AS %s, %s, GROUP_CONCAT(%s,';') AS %s FROM %s JOIN %s ON %s = %s WHERE %s IN (%s) GROUP BY %s, %s", ENTRY_T_ID, ENTRY_T_ID, identifierStates, ENTRY_T_OUT, ENTRY_T_ACT, ENTRY_T_PROB, ENTRY_T_PROB , TABLE_TRANS, TABLE_STATES, ENTRY_S_ID, ENTRY_T_OUT ,ENTRY_T_OUT, stateID, groupStates, ENTRY_T_ACT), new TransitionMapper(this, activeViews, reverseView));

            Set<String> statesOfInterest = new HashSet<>();
            for (Transition t : transitions) {
                statesOfInterest.add(t.getSource());
                statesOfInterest.addAll(new ArrayList<>(t.getProbabilityDistribution().keySet()));
            }
            String stateString = statesOfInterest.stream().map(s -> String.format("'%s'", s)).collect(Collectors.joining(","));

            List<State> states = database.executeCollectionQuery(String.format("SELECT %s as %s, GROUP_CONCAT(%s,';') AS %s FROM %s WHERE %s IN (%s) GROUP BY %s", identifierStates, ENTRY_C_NAME, ENTRY_S_ID, ENTRY_C_SUB, TABLE_STATES, ENTRY_C_NAME, stateString, groupStates), new StateMapper(this, activeViews));
            return new Graph(this, states, transitions);
        }catch (Exception e){
            throw new RuntimeException(e);
        }
    }

    public Graph resetGraph(List<Long> stateIDs, List<Long> unexploredStateIDs){
        if (!built) {
            try {
                return modelParser.resetGraph(stateIDs, unexploredStateIDs);
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        }
        String stateID = stateIDs.stream().map(l -> Long.toString(l)).collect(Collectors.joining(","));
        List<Transition> transitions = database.executeCollectionQuery(String.format("SELECT * FROM %s WHERE %s IN (%s)", TABLE_TRANS, ENTRY_T_OUT, stateID), new TransitionMapper(this));
        Set<String> statesOfInterest = new HashSet<>();
        for (Long unStateID : unexploredStateIDs){
            statesOfInterest.add(Long.toString(unStateID));
        }
        for (Transition t : transitions) {
            statesOfInterest.add(t.getSource());
            statesOfInterest.addAll(new ArrayList<>(t.getProbabilityDistribution().keySet()));
        }
        String stateString = String.join(",", statesOfInterest);
        List<State> states = database.executeCollectionQuery(String.format("SELECT * FROM %s WHERE %s in (%s)", TABLE_STATES, ENTRY_S_ID, stateString), new StateMapper(this, null));
        return new Graph(this, states, transitions);
    }

    /*
    public Graph getIncoming(long stateID) {
        List<State> states = database.executeCollectionQuery(String.format("SELECT %s.* FROM %s LEFT JOIN %s ON %s.%s = %s.%s WHERE %s.%s = %s OR %s.%s = %s", TABLE_STATES, TABLE_STATES, TABLE_TRANS, TABLE_STATES, ENTRY_S_ID, TABLE_TRANS, ENTRY_T_OUT, TABLE_TRANS, ENTRY_T_IN, stateID, TABLE_STATES, ENTRY_S_ID, stateID), new StateMapper(parent,0));
        List<Transition> transitions = database.executeCollectionQuery(String.format("SELECT *, GROUP_CONCAT(%s || ':' || %s, ';') as %s FROM %s WHERE %s == %s GROUP BY %s, %s",ENTRY_T_IN, ENTRY_T_PROB, ENTRY_T_MAP, TABLE_TRANS, ENTRY_T_IN, stateID, ENTRY_T_OUT, ENTRY_T_ACT), new TransitionMapper());
        return new Graph(states, transitions);
    }*/

    // Views

    public void createView(ViewType type, List<String> parameters) throws Exception {
        int viewID = views.size();


        //Filters a few Control Commands encode as view types
        switch(type){
            case Clear: {
                if (!views.isEmpty()) {
                    clearViews();
                }
            }
            case Remove: {
                if (!views.isEmpty()) {
                    if (parameters.size() != 1) throw new Exception("need to provide number of View you want to remove!");
                    int n = Integer.parseInt(parameters.get(0));
                    if (n < 0 || n >= views.size()) throw new Exception("Could not find View number " + n);
                    View viewN = views.get(n);
                    getDatabase().execute(String.format("ALTER TABLE %s DROP COLUMN %s", getStateTableName(), viewN.getCollumn()));
                    views.remove(viewN);
                    organizeIds();
                }
            }
            default: {
                View v = View.createView(this, type, parameters, viewID);
                if (views.contains(v)) throw new Exception("View already exists");
                v.buildView();
                views.add(v);

            }
        }
    }

    public void organizeIds() {
        long i = 0;
        for (View view : views) {
            view.setId(i);
            i++;
        }
    }

    public ViewType columnToViewType(String columnName) {
        for (ViewType viewType : ViewType.values()) {
            if (columnName.contains(viewType.name())) {
                return viewType;
            }
        }
        return null;
    }

    public List<View> getViews(){
        return this.views;
    }

    public List<View> getViews(List<Integer> ids){
        return views.stream().filter(v -> ids.contains((int) v.getId())).collect(Collectors.toList());
    }

    public List<Property> getProperties() {
        return this.properties;
    }

    public List<Scheduler> getSchedulers() {
        return this.schedulers;
    }

    public List<String> getLabels(parser.State state) throws Exception {
        List<String> labels = new ArrayList<>();
        if (isInitial(state)) labels.add(LABEL_INIT);
        if (isDeadlocked(state)) labels.add(LABEL_DEAD);
        for (int i = 0; i < modulesFile.getLabelList().size(); i++){
            if (modulesFile.getLabelList().getLabel(i).evaluateBoolean(modulesFile.getConstantValues(), state)){
                labels.add(modulesFile.getLabelName(i));
            }
        }
        return labels;
    }

    private boolean isDeadlocked(parser.State state) throws PrismException {
        TransitionList<Double> transitionList = new TransitionList<>(Evaluator.forDouble());
        modelChecker.getUpdater().calculateTransitions(state, transitionList);
        return transitionList.isDeadlock();
    }

    private boolean isInitial(parser.State state) throws PrismLangException {
        if (modulesFile.getInitialStates() != null) {
            return modulesFile.getInitialStates().evaluateBoolean(modulesFile.getConstantValues(), state);
        } else {
            return modulesFile.getDefaultInitialState().equals(state);
        }
    }

    public TreeMap<String, AP> getLabelMap(parser.State state) throws Exception {
        TreeMap<String, AP> labels = new TreeMap<>();
        labels.put(LABEL_INIT, isInitial(state)?APs.get(LABEL_INIT): null);
        labels.put(LABEL_DEAD, isDeadlocked(state)?APs.get(LABEL_DEAD): null);
        for (int i = 0; i < modulesFile.getLabelList().size(); i++){
            String name = modulesFile.getLabelName(i);
            labels.put(name, modulesFile.getLabelList().getLabel(i).evaluateBoolean(modulesFile.getConstantValues(), state) ? APs.get(name) : null);
        }
        return labels;
    }

    public TreeMap<String, Object> getInformation() {
        TreeMap<String, Object> outInfo = new TreeMap<>(this.info);
        TreeMap<String, Integer> schedulerInfo = new TreeMap<>();
        for (Scheduler s : schedulers){
            schedulerInfo.put(s.getName(), s.getId());
        }
        outInfo.put(OUTPUT_SCHEDULER, schedulerInfo);
        return outInfo;
    }

    public void removeFiles() throws Exception {
        File directory = new File(String.format("%s/%s", rootDir, id));
        if (directory.exists()) {
            for (File file : Objects.requireNonNull(directory.listFiles())) {
                file.delete();
            }
            directory.delete();
        }
    }

    public void clearTables() throws Exception {
        schedulers.clear();
        for (Property p : properties) {
            p.clear();
        }
        modelChecker.reset();
    }

    // adds DummyView internally for each View in DB for displaying and modifying views
    // can also
    // * clear all views on startup
    // * build views on all models
    //      -> Clear needed before!
    //      -> Caution: Model() crashes if too much time needed by buildView()
    private void makeViewDbAndViewInternalConsistent(){
        try {
            //insert dummy views into "List<View> views" for each views that is still in DB
            List<String> viewsInDb = database
                    .executeCollectionQuery(String.format("SELECT name FROM pragma_table_info('%s')", TABLE_STATES))
                    .stream()
                    .flatMap(map -> map.values().stream().map(String::valueOf))
                    .filter(columnName -> columnName.contains("View"))
                    .collect(Collectors.toList());
            int viewId = 0;
            for (String viewString : viewsInDb) {
                ViewType viewType = columnToViewType(viewString);
                views.add(new DummyView(this, viewId, viewType, viewString));
                viewId++;
            }
        } finally {}
    }

    private void clearViews()  {
        if (views.isEmpty()) {
            return;
        }
        List<String> clearTableQry = List.of();
        try {
            // create SQL String for each View and execute them with executeBatch
            clearTableQry = views.stream()
                            .map(view -> String.format("ALTER TABLE %s DROP COLUMN %s", getStateTableName(), view.getCollumn()))
                            .collect(Collectors.toList());
            getDatabase().executeBatch(clearTableQry);
        } catch (Exception e) {
            if (clearTableQry.isEmpty()) {
                throw new RuntimeException("clearTableQry in project.clearViews() was empty!", e);
            }
            else {
                throw new RuntimeException(e);
            }

        }
        views = new ArrayList<>();
    }

    public void removeViewFromDbByColName(String columnNameView) {
        try {
            getDatabase().execute(String.format("ALTER TABLE %s DROP COLUMN %s;", TABLE_STATES, columnNameView));
            List<View> viewsWithName = views
                    .stream()
                    .filter(view -> view.getCollumn().equals(columnNameView))
                    .collect(Collectors.toList());
            if (viewsWithName.size() == 0) {
                throw new Exception("No View with that name found in model.views");
            }
            if (viewsWithName.size() > 1) {
                System.out.println("There is more than one views with this name in model.views! The View with the lowest id, will be removed.");
            }
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    public long getSize() {
        return this.modelChecker.getModel().getNumStates();
    }

    public File getLog(){
        return this.outLog;
    }

    public String getSchedulerTableName() {
        return this.TABLE_SCHED;
    }

    public void removeFromViews(View view) {
        int i = views.indexOf(view);
        if (i > -1) views.remove(i);
    }
}
