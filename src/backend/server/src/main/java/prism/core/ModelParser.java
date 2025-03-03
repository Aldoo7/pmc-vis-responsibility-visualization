package prism.core;

import parser.State;
import parser.VarList;
import parser.ast.Expression;
import parser.ast.ExpressionReward;
import parser.ast.ModulesFile;
import parser.ast.PropertiesFile;
import parser.type.Type;
import parser.type.TypeBool;
import parser.type.TypeDouble;
import parser.type.TypeInt;
import prism.*;
import prism.api.*;
import prism.core.Utility.Prism.Updater;
import simulator.Choice;
import simulator.TransitionList;
import simulator.method.*;
import strat.StrategyGenerator;

import java.io.File;
import java.util.*;
import java.util.stream.Collectors;

public class ModelParser {

    private static final Type[] valueTypes = {TypeInt.getInstance(), TypeDouble.getInstance(), TypeBool.getInstance()};

    private final Project project;
    private final ModulesFile modulesFile;
    private final Prism prism;
    private Updater updater;

    private List<parser.State> visitedStates;
    private List<Pair<parser.State, String>> visitedTransitions;

    public ModelParser(Project project, ModulesFile modulesFile, boolean debug) {
        this.project = project;
        this.modulesFile = modulesFile;
        if (debug) this.prism = new Prism(new PrismPrintStreamLog(System.out));
        else this.prism = new Prism(new PrismDevNullLog());
        try {
            this.updater = new Updater(modulesFile, prism);
        }catch (PrismException e){
            throw new RuntimeException(e);
        }

        this.visitedStates = new ArrayList<>();
        this.visitedTransitions = new ArrayList<>();
    }

    public String normalizeStateName(String stateDescription) {
        String intern = stateDescription.replace(" ", "");

        // Remove parentheses if necessary
        if (intern.startsWith("(")) {
            intern = stateDescription.substring(1, stateDescription.length() - 1);
        }

        //Replace , by ;
        if (!intern.contains(";")) {
            intern = intern.replace(",", ";");
        }

        try {
            if (stateDescription.contains("=")) {
                String[] ids = intern.split(";");
                String[] ordered = new String[ids.length];
                VarList v  = modulesFile.createVarList();

                for (String id : ids) {
                    String[] assignment = id.split("=");
                    if (assignment.length != 2) {
                        throw new RuntimeException("Invalid assignment: " + id);
                    }
                    int loc = v.getIndex(assignment[0]);
                    ordered[loc] = assignment[1];
                }
                StringBuilder out = null;
                for (String o : ordered) {
                    if (out == null) {
                        out = new StringBuilder();
                    } else {
                        out.append(";");
                    }
                    out.append(o);
                }
                intern = (out == null ? null : out.toString());
            }
        } catch (PrismException e) {
            throw new RuntimeException(e);
        }
        return intern;
    }

    public parser.State parseState(String stringValues) throws PrismLangException {
        String intern = stringValues;

        // Remove parentheses if necessary
        if (intern.startsWith("(")) {
            intern = stringValues.substring(1, stringValues.length() - 1);
        }

        //Replace , by ;
        if (!intern.contains(";")) {
            intern = intern.replace(",", ";");
        }

        //Construct Prism State manually , Prism internal function slightly broken
        String[] ids = intern.split(";");
        parser.State state = new parser.State(ids.length);

        if (!stringValues.contains("=")) {
            //Assignment per order
            int i = 0;
            for (String id : ids) {
                String assignment = id.strip();
                Object value = null;
                for (Type t : valueTypes) {
                    try {
                        value = castStringToType(assignment, t);
                        break;
                    } catch (PrismLangException e) {
                        value = null;
                    } catch (java.lang.NumberFormatException e){
                        value = null;
                    }
                }
                if (value == null) {
                    System.out.println(id);
                    throw new PrismLangException("Invalid value: " + id);
                }
                state.setValue(i, value);
                i++;
            }
        } else {
            //Direct Assignment
            for (String id : ids) {
                String[] assignment = id.split("=");
                if (assignment.length != 2) {
                    throw new PrismLangException("Invalid assignment: " + id);
                }
                Object value = null;
                for (Type t : valueTypes) {
                    try {
                        value = castStringToType(assignment[1], t);
                        break;
                    } catch (PrismLangException | NumberFormatException e) {
                        value = null;
                    }
                }
                if (value == null) {
                    throw new PrismLangException("Invalid value in: " + id);
                }
                state.setValue(modulesFile.getVarIndex(assignment[0]), value);
            }
        }
        return state;
    }

    public Map<String, Object> parseParameters(String stringValues) throws PrismLangException {
        parser.State state = parseState(stringValues);
        Map<String, Object> variables = new HashMap<>();
        for (int i = 0; i < state.varValues.length; i++) {
            variables.put(modulesFile.getVarName(i), state.varValues[i]);
        }
        return variables;
    }

    public static Object castStringToType(String s, Type t) throws PrismLangException {
        switch (t.getTypeString()) {
            case "int":
                return t.castValueTo(Integer.valueOf(s));
            case "double":
                return t.castValueTo(Double.valueOf(s));
            case "bool":
                return t.castValueTo(Boolean.valueOf(s));
        }
        throw new PrismLangException("Unknown Type");
    }

    public Expression parseSingleExpressionString(String expression) throws PrismLangException {
        return Prism.parseSingleExpressionString(expression);
    }

    public List<parser.State> getInitialStateObjects() throws Exception {
        List<parser.State> initials = new ArrayList<>();

        if (modulesFile.getInitialStates() != null) {
            Expression initialExpression = modulesFile.getInitialStates();
            for (parser.State state : modulesFile.createVarList().getAllStates()) {
                if (initialExpression.evaluateBoolean(state)) {
                    initials.add(state);
                }
            }
        } else {
            initials.add(modulesFile.getDefaultInitialState());
        }

        return initials;
    }


    private prism.api.State convertApiState(parser.State state) throws Exception {
        if (!visitedStates.contains(state)){
            visitedStates.add(state);
        }

        Map<String, Object> variables = new HashMap<>();
        for (int i = 0; i < state.varValues.length; i++) {
            variables.put(modulesFile.getVarName(i), state.varValues[i]);
        }

        return new prism.api.State(visitedStates.indexOf(state), state.toString(), variables, project.getLabelMap(state), new TreeMap<>(), new TreeMap<>());
    }

    private Transition convertApiTransition(parser.State out, String action, Map<parser.State, Double> distribution) throws Exception {
        Pair<parser.State, String> identifier = new Pair<>(out, action);
        if (!visitedTransitions.contains(identifier)){
            visitedTransitions.add(identifier);
        }

        Map<Long, Double> outDistribution = new HashMap<>();
        for (parser.State state : distribution.keySet()) {
            outDistribution.put((long) visitedStates.indexOf(state), distribution.get(state));
        }

        return new Transition(visitedTransitions.indexOf(identifier), String.valueOf(visitedStates.indexOf(out)), action, outDistribution, null, null, null, null, null);
    }

    // Output Functions

    public Graph getInitialNodes() throws Exception {
        List<parser.State> initialStates = this.getInitialStateObjects();
        List<prism.api.State> states = new ArrayList<>();

        for (parser.State state : initialStates) {
            states.add(convertApiState(state));
        }
        
        return new Graph(project, states, new ArrayList<>());
    }

    public Graph getGetGraph() throws Exception {
        List<parser.State> states = this.getInitialStateObjects();
        List<prism.api.State> outStates = new ArrayList<>();
        List<Transition> transitions = new ArrayList<>();

        for (parser.State state : states) {
            outStates.add(convertApiState(state));
        }

        while (!states.isEmpty()) {
            parser.State state = states.remove(0);
            TransitionList<Double> transitionList = new TransitionList<>(Evaluator.forDouble());
            updater.calculateTransitions(state, transitionList);
            for (int i = 0; i < transitionList.getNumChoices(); i++) {
                Choice<Double> choice = transitionList.getChoice(i);
                String actionName = choice.getModuleOrAction();

                Map<parser.State, Double> probabilities = new HashMap<>();

                for (int j = 0; j < choice.size(); j++) {
                    double probability = choice.getProbability(j);
                    parser.State target = choice.computeTarget(j, state, modulesFile.createVarList());
                    if (!visitedStates.contains(target)) {
                        outStates.add(convertApiState(target));
                        states.add(target);
                    }
                    probabilities.put(target, probability);
                }

                transitions.add(convertApiTransition(state, actionName, probabilities));
            }
        }
        return new Graph(project, outStates, transitions);
    }

    public Graph getSubGraph(List<Long> stateIDs) throws Exception {
        List<parser.State> states = new ArrayList<>();
        List<prism.api.State> outStates = new ArrayList<>();
        List<Transition> transitions = new ArrayList<>();

        for (Long stateID : stateIDs) {
            states.add(visitedStates.get(Math.toIntExact(stateID)));
        }

        for (parser.State state : states) {
            outStates.add(convertApiState(state));
        }

        for (parser.State state : states) {
            TransitionList<Double> transitionList = new TransitionList<>(Evaluator.forDouble());
            updater.calculateTransitions(state, transitionList);
            for (int i = 0; i < transitionList.getNumChoices(); i++) {
                boolean contained = true;
                Choice<Double> choice = transitionList.getChoice(i);
                String actionName = choice.getModuleOrAction();

                Map<parser.State, Double> probabilities = new HashMap<>();

                for (int j = 0; j < choice.size(); j++) {
                    double probability = choice.getProbability(j);
                    parser.State target = choice.computeTarget(j, state, modulesFile.createVarList());
                    if (!visitedStates.contains(target)) {
                        contained = false;
                    }
                    probabilities.put(target, probability);
                }
                if (contained) {
                    transitions.add(convertApiTransition(state, actionName, probabilities));
                }
            }
        }
        return new Graph(project, outStates, transitions);
    }

    public Graph getOutgoing(List<Long> stateIDs) throws Exception {
        List<parser.State> states = new ArrayList<>();
        List<prism.api.State> outStates = new ArrayList<>();
        List<Transition> transitions = new ArrayList<>();

        for (Long stateID : stateIDs) {
            states.add(visitedStates.get(Math.toIntExact(stateID)));
        }

        for (parser.State state : states) {
            outStates.add(convertApiState(state));
        }

        for (parser.State state : states) {
            TransitionList<Double> transitionList = new TransitionList<>(Evaluator.forDouble());
            updater.calculateTransitions(state, transitionList);
            for (int i = 0; i < transitionList.getNumChoices(); i++) {
                Choice<Double> choice = transitionList.getChoice(i);
                String actionName = choice.getModuleOrAction();

                Map<parser.State, Double> probabilities = new HashMap<>();

                for (int j = 0; j < choice.size(); j++) {
                    double probability = choice.getProbability(j);
                    parser.State target = choice.computeTarget(j, state, modulesFile.createVarList());
                    outStates.add(convertApiState(target));
                    probabilities.put(target, probability);
                }

                transitions.add(convertApiTransition(state, actionName, probabilities));
            }
        }
        return new Graph(project, outStates, transitions);

    }


//    public List<Result[]> modelCheckSimulator(File properties, List<State> initialStates, long maxPathLength, String simulationMethod, boolean parallel, Optional<Scheduler> scheduler) throws Exception {
//
//        PropertiesFile propertiesFile = prism.parsePropertiesFile(properties);
//        SimulatorEngine simulator = prism.getSimulator();
//        PrismLog mainLog = prism.getMainLog();
//        List<Expression> exprs = new ArrayList<>();
//
//        ModelGenerator<Double> modelGen = (ModelGenerator<Double>) prism.getModelGenerator();
//        RewardGenerator<Double> rewardGen;
//        if (modelGen instanceof RewardGenerator) {
//            rewardGen = (RewardGenerator<Double>) modelGen;
//        } else {
//            rewardGen = new RewardGenerator<>() {};
//        }
//
//        simulator.loadModel(modelGen, rewardGen);
//
//        for (int i=0; i< propertiesFile.getNumProperties(); i++){
//            exprs.add(propertiesFile.getProperty(i));
//        }
//        if (scheduler.isPresent()) {
//            StrategyGenerator<Double> strategy = new MDStrategyDB(model, project.getDatabase(), project.getTransitionTableName(), scheduler.get().getCollumnName(), true);
//            simulator.loadStrategy(strategy);
//        }
//
//        // Print info
//        mainLog.printSeparator();
//        mainLog.print("\nSimulating");
//        if (exprs.size() == 1) {
//            mainLog.println(": " + exprs.get(0));
//        } else {
//            mainLog.println(" " + exprs.size() + " properties:");
//            for (int i = 0; i < exprs.size(); i++) {
//                mainLog.println(" " + exprs.get(i));
//            }
//        }
//        //if (currentDefinedMFConstants != null && currentDefinedMFConstants.getNumValues() > 0)
//        //    mainLog.println("Model constants: " + currentDefinedMFConstants);
//        //if (definedPFConstants != null && definedPFConstants.getNumValues() > 0)
//        //    mainLog.println("Property constants: " + definedPFConstants);
//
//        if (prism.getModelType().nondeterministic() && prism.getModelType().removeNondeterminism() != prism.getModelType()) {
//            mainLog.printWarning("For simulation, nondeterminism in " + prism.getModelType() + " is resolved uniformly (resulting in " + prism.getModelType().removeNondeterminism() + ").");
//        }
//
//        // Check that properties are valid for this model type
//        for (Expression expr : exprs)
//            expr.checkValid(prism.getModelType().removeNondeterminism());
//
//        List<State> states = initialStates;
//        //Check if intitialStates is null or empty, get model initial states instead
//        if (initialStates == null || initialStates.isEmpty()){
//            states = project.getInitialStateObjects();
//        }
//
//        // Do simulation
//        List<Result[]> resArrays = new ArrayList<>();
//
//        for (State s : states){
//            Result[] resArray;
//
//            if (parallel){
//                //Match simulation Method
//                SimulationMethod simMethod = processSimulationOptions(exprs.get(0), simulationMethod);
//                resArray = simulator.modelCheckMultipleProperties(propertiesFile, exprs, s, maxPathLength, simMethod);
//            }else{
//                resArray = new Result[exprs.size()];
//                for (int i = 0; i < exprs.size(); i++){
//                    //Match simulation Method
//                    SimulationMethod simMethod = processSimulationOptions(exprs.get(i), simulationMethod);
//                    Result res = simulator.modelCheckSingleProperty(propertiesFile, exprs.get(i), s, maxPathLength, simMethod);
//                    resArray[i] = res;
//                }
//            }
//            resArrays.add(resArray);
//        }
//
//        return resArrays;
//    }
//
//    private SimulationMethod processSimulationOptions(Expression expr, String simMethodName) throws PrismException
//    {
//        SimulationMethod aSimMethod = null;
//
//        // See if property to be checked is a reward (R) operator
//        boolean isReward = (expr instanceof ExpressionReward);
//
//        // See if property to be checked is quantitative (=?)
//        boolean isQuant = Expression.isQuantitative(expr);
//
//        // Pick defaults for simulation settings
//        double simApprox = prism.getSettings().getDouble(PrismSettings.SIMULATOR_DEFAULT_APPROX);
//        double simConfidence = prism.getSettings().getDouble(PrismSettings.SIMULATOR_DEFAULT_CONFIDENCE);
//        int simNumSamples = prism.getSettings().getInteger(PrismSettings.SIMULATOR_DEFAULT_NUM_SAMPLES);
//        double simWidth = prism.getSettings().getDouble(PrismSettings.SIMULATOR_DEFAULT_WIDTH);
//
//        int reqIterToConclude = prism.getSettings().getInteger(PrismSettings.SIMULATOR_DECIDE);
//        double simMaxReward = prism.getSettings().getDouble(PrismSettings.SIMULATOR_MAX_REWARD);
//        double simMaxPath = prism.getSettings().getLong(PrismSettings.SIMULATOR_DEFAULT_MAX_PATH);
//
//        // Pick a default method, if not specified
//        // (CI for quantitative, SPRT for bounded)
//        if (simMethodName == null) {
//            simMethodName = isQuant ? "ci" : "sprt";
//        }
//
//        // CI
//        if (simMethodName.equals("ci")) {
//            /*if (simWidthGiven && simConfidenceGiven && simNumSamplesGiven) {
//                throw new PrismException("Cannot specify all three parameters (width/confidence/samples) for CI method");
//            }
//            if (!simWidthGiven) {
//                // Default (unless width specified) is to leave width unknown
//                aSimMethod = new CIwidth(simConfidence, simNumSamples);
//            } else if (!simNumSamplesGiven) {
//                // Next preferred option (unless specified) is unknown samples
//                if (simManual)
//                    aSimMethod = new CIiterations(simConfidence, simWidth, reqIterToConclude);
//                else
//                    aSimMethod = (isReward ? new CIiterations(simConfidence, simWidth, simMaxReward) : new CIiterations(simConfidence, simWidth));
//            } else {*/
//            // Otherwise confidence unknown
//            aSimMethod = new CIconfidence(simWidth, simNumSamples);
//            //}
//            //if (simApproxGiven) {
//            //    mainLog.printWarning("Option -simapprox is not used for the CI method and is being ignored");
//            //}
//        }
//        // ACI
//        else if (simMethodName.equals("aci")) {
//            /*if (simWidthGiven && simConfidenceGiven && simNumSamplesGiven) {
//                throw new PrismException("Cannot specify all three parameters (width/confidence/samples) for ACI method");
//            }
//            if (!simWidthGiven) {
//                // Default (unless width specified) is to leave width unknown
//                aSimMethod = new ACIwidth(simConfidence, simNumSamples);
//            } else if (!simNumSamplesGiven) {
//                // Next preferred option (unless specified) is unknown samples
//                if (simManual)
//                    aSimMethod = new ACIiterations(simConfidence, simWidth, reqIterToConclude);
//                else
//                    aSimMethod = (isReward ? new ACIiterations(simConfidence, simWidth, simMaxReward) : new CIiterations(simConfidence, simWidth));
//            } else {*/
//            // Otherwise confidence unknown
//            aSimMethod = new ACIconfidence(simWidth, simNumSamples);
//            /*}
//            if (simApproxGiven) {
//                mainLog.printWarning("Option -simapprox is not used for the ACI method and is being ignored");
//            }*/
//        }
//        // APMC
//        else if (simMethodName.equals("apmc")) {
//            /*if (isReward) {
//                throw new PrismException("Cannot use the APMC method on reward properties; try CI (switch -simci) instead");
//            }
//            if (simApproxGiven && simConfidenceGiven && simNumSamplesGiven) {
//                throw new PrismException("Cannot specify all three parameters (approximation/confidence/samples) for APMC method");
//            }
//            if (!simApproxGiven) {
//                // Default (unless width specified) is to leave approximation unknown
//                aSimMethod = new APMCapproximation(simConfidence, simNumSamples);
//            } else if (!simNumSamplesGiven) {
//                // Next preferred option (unless specified) is unknown samples
//                aSimMethod = new APMCiterations(simConfidence, simApprox);
//            } else {*/
//            // Otherwise confidence unknown
//            aSimMethod = new APMCconfidence(simApprox, simNumSamples);
//            /*}
//            if (simWidthGiven) {
//                mainLog.printWarning("Option -simwidth is not used for the APMC method and is being ignored");
//            }*/
//        }
//        // SPRT
//        else if (simMethodName.equals("sprt")) {
//            if (isQuant) {
//                throw new PrismException("Cannot use SPRT on a quantitative (=?) property");
//            }
//            aSimMethod = new SPRTMethod(simConfidence, simConfidence, simWidth);
//            /*if (simApproxGiven) {
//                mainLog.printWarning("Option -simapprox is not used for the SPRT method and is being ignored");
//            }
//            if (simNumSamplesGiven) {
//                mainLog.printWarning("Option -simsamples is not used for the SPRT method and is being ignored");
//            }*/
//        } else
//            throw new PrismException("Unknown simulation method \"" + simMethodName + "\"");
//
//        return aSimMethod;
//    }

}
