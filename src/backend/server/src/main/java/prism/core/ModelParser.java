package prism.core;

import com.google.common.math.BigIntegerMath;
import parser.State;
import parser.Values;
import parser.VarList;
import parser.ast.Expression;
import parser.ast.ModulesFile;
import parser.ast.RewardStruct;
import parser.type.Type;
import parser.type.TypeBool;
import parser.type.TypeDouble;
import parser.type.TypeInt;
import prism.*;
import prism.api.*;
import prism.core.Utility.Prism.Updater;
import simulator.Choice;
import simulator.TransitionList;

import java.math.BigInteger;
import java.math.RoundingMode;
import java.util.*;

public class ModelParser {

    private static final Type[] valueTypes = {TypeInt.getInstance(), TypeDouble.getInstance(), TypeBool.getInstance()};

    private final Project project;
    private final ModulesFile modulesFile;
    private final Updater updater;

    private final VarList varList;
    private final BigInteger maxStateIndex;
    private List<parser.State> initials;

    public ModelParser(Project project, ModulesFile modulesFile, boolean debug) {
        this.project = project;
        this.modulesFile = modulesFile;
        Prism prism;
        if (debug) prism = new Prism(new PrismPrintStreamLog(System.out));
        else prism = new Prism(new PrismDevNullLog());
        try {
            this.updater = new Updater(modulesFile, prism);
            this.varList = modulesFile.createVarList();
            BigInteger index = BigInteger.ONE;
            for (int i = 0; i < varList.getNumVars(); i++) {
                int range = varList.getRange(i);
                index = index.multiply(BigInteger.valueOf(range));
                System.out.println("Name: " + varList.getName(i) + " , Range: " + range);
                System.out.println(index);
            }
            this.maxStateIndex = index;
        }catch (PrismException e){
            throw new RuntimeException(e);
        }

        TreeMap<String, VariableInfo> info = new TreeMap<>();
        for (int i = 0; i < varList.getNumVars() ; i++) {
            String name = varList.getName(i);
            info.put(name, new VariableInfo(name, VariableInfo.parseType(varList.getType(i).getTypeString()), varList.getLow(i), varList.getHigh(i) ));
        }
        project.getInfo().setStateEntry(Namespace.OUTPUT_VARIABLES, info);
        info = new TreeMap<>();
        for (int i = 0; i < modulesFile.getNumRewardStructs() ; i++) {
            RewardStruct rw = modulesFile.getRewardStruct(i);
            String name = rw.getName();
            info.put(name, new VariableInfo(name, VariableInfo.Type.TYPE_NUMBER, 0, Double.POSITIVE_INFINITY));
        }
        project.getInfo().setStateEntry(Namespace.OUTPUT_REWARDS, info);
        project.getInfo().setTransitionEntry(Namespace.OUTPUT_REWARDS, info);
        try {
            buildInitialStateObjects();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
        if(debug){
            System.out.println("Parsed Model with " + this.maxStateIndex + " possible states");
        }
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
                    } catch (PrismLangException | NumberFormatException e) {
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

    public void buildInitialStateObjects() throws Exception {
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
        this.initials = initials;
    }

    public BigInteger stateIdentifier(parser.State state) {
        BigInteger index = BigInteger.ZERO;
        BigInteger prevRange = BigInteger.ONE;

        for (int i = varList.getNumVars()-1; i >= 0; i--) {

            int minValue = varList.getLow(i);
            int maxValue = varList.getHigh(i);

            int range = (maxValue - minValue) + 1;
            int value;

            int position = modulesFile.getVarIndex(varList.getName(i));

            switch(varList.getType(i).getTypeString()){
                case "int":
                    value = (int) state.varValues[position];
                    break;
                case "bool":
                    boolean bool = (boolean) state.varValues[position];
                    value = bool ? 1 : 0;
                    break;
                default:
                    throw new RuntimeException("Unknown type: " + varList.getType(i).getTypeString());
            }

            index = index.add(prevRange.multiply(BigInteger.valueOf(value - minValue)));
            prevRange = prevRange.multiply(BigInteger.valueOf(range));
        }

        return index;
    }

    public BigInteger stateIdentifier(int[] values) {
        BigInteger index = BigInteger.ZERO;
        BigInteger prevRange = BigInteger.ONE;

        for (int i = varList.getNumVars()-1; i >= 0; i--) {

            int minValue = varList.getLow(i);
            int maxValue = varList.getHigh(i);

            int range = (maxValue - minValue) + 1;
            int position = modulesFile.getVarIndex(varList.getName(i));

            int value = values[position];

            if (value < minValue || value > maxValue) {
                System.out.println("Value " + value + " is out of range");
                throw new RuntimeException("Value " + value + " is out of range");}

            index = index.add(prevRange.multiply(BigInteger.valueOf(value - minValue)));
            prevRange = prevRange.multiply(BigInteger.valueOf(range));
        }

        return index;
    }

    public parser.State translateStateIdentifier(BigInteger stateIdentifier) {
        parser.State state = new State(varList.getNumVars());

        BigInteger prevRange = BigInteger.ONE;

        for (int i = varList.getNumVars()-1; i >= 0; i--) {
            int minValue = varList.getLow(i);
            int maxValue = varList.getHigh(i);

            int position = modulesFile.getVarIndex(varList.getName(i));

            BigInteger range = BigInteger.valueOf((maxValue - minValue) + 1);
            int value = BigIntegerMath.divide(stateIdentifier, prevRange, RoundingMode.DOWN).mod(range).intValue();
            value += minValue;

            switch(varList.getType(i).getTypeString()){
                case "int":
                    state.setValue(position, value);
                    break;
                case "bool":
                    boolean bool = value > 0;
                    state.setValue(position, bool);
                    break;
                default:
                    throw new RuntimeException("Unknown type: " + varList.getType(i).getTypeString());
            }

            prevRange = prevRange.multiply(range);
        }

        return state;
    }

    public BigInteger transitionIdentifier(parser.State outState, Choice<Double> choice) {
        BigInteger index = stateIdentifier(outState);

        int minValue = -modulesFile.getNumModules();
        int value = choice.getModuleOrActionIndex();
        if (value > 0) {
            value -= 1;
        }

        return index.add(this.maxStateIndex.multiply(BigInteger.valueOf(value - minValue)));
    }

    private prism.api.State convertApiState(parser.State state) throws Exception {
        BigInteger stateidentifier = stateIdentifier(state);

        int numRewards = modulesFile.getNumRewardStructs();
        List<String> rewardNames = modulesFile.getRewardStructNames();
        double[] rewardValues = new double[numRewards];

        updater.calculateStateRewards(state, rewardValues);

        Map<String, Object> variables = new HashMap<>();
        for (int i = 0; i < state.varValues.length; i++) {
            variables.put(modulesFile.getVarName(i), state.varValues[i]);
        }

        Map<String, Double> rewards = new TreeMap<>();
        for (int i = 0; i < numRewards; i++) {
            rewards.put(rewardNames.get(i), rewardValues[i]);
        }

        return new prism.api.State(stateidentifier.toString(), state.toString(), variables, project.getLabelMap(state), rewards, new TreeMap<>());
    }

    private Transition convertApiTransition(parser.State out, Choice<Double> choice, Map<parser.State, Double> distribution) throws Exception {
        BigInteger identifier = transitionIdentifier(out, choice);

        int numRewards = modulesFile.getNumRewardStructs();
        List<String> rewardNames = modulesFile.getRewardStructNames();
        double[] rewardValues = new double[numRewards];

        updater.calculateTransitionRewards(out, choice.getModuleOrActionIndex(), rewardValues);


        Map<String, Double> outDistribution = new HashMap<>();
        for (parser.State state : distribution.keySet()) {
            outDistribution.put(stateIdentifier(state).toString(), distribution.get(state));
        }

        Map<String, Double> rewards = new TreeMap<>();
        for (int i = 0; i < numRewards; i++) {
            rewards.put(rewardNames.get(i), rewardValues[i]);
        }

        return new Transition(identifier.toString(), stateIdentifier(out).toString(), choice.getModuleOrAction(), outDistribution, rewards, null, null, null, null);
    }

    // Output Functions

    public Graph getInitialNodes() throws Exception {
        List<parser.State> initialStates = this.initials;
        List<prism.api.State> states = new ArrayList<>();

        for (parser.State state : initialStates) {
            states.add(convertApiState(state));
        }
        
        return new Graph(project, states, new ArrayList<>());
    }

    public Graph getGraph() throws Exception {
        List<parser.State> states = this.initials;
        List<parser.State> visited = new ArrayList<>();

        List<prism.api.State> outStates = new ArrayList<>();
        List<Transition> transitions = new ArrayList<>();

        while (!states.isEmpty()) {
            parser.State state = states.remove(0);
            outStates.add(convertApiState(state));
            visited.add(state);

            TransitionList<Double> transitionList = new TransitionList<>(Evaluator.forDouble());
            updater.calculateTransitions(state, transitionList);

            for (int i = 0; i < transitionList.getNumChoices(); i++) {
                Choice<Double> choice = transitionList.getChoice(i);

                Map<parser.State, Double> probabilities = new HashMap<>();

                for (int j = 0; j < choice.size(); j++) {
                    double probability = choice.getProbability(j);
                    parser.State target = choice.computeTarget(j, state, modulesFile.createVarList());
                    if (!states.contains(target) | visited.contains(target)) {
                        states.add(target);
                    }
                    probabilities.put(target, probability);
                }

                transitions.add(convertApiTransition(state, choice, probabilities));
            }
        }
        return new Graph(project, outStates, transitions);
    }

    public Graph getSubGraph(List<String> stateIDs) throws Exception {
        List<parser.State> states = new ArrayList<>();
        List<prism.api.State> outStates = new ArrayList<>();
        List<Transition> transitions = new ArrayList<>();

        for (String stateID : stateIDs) {
            states.add(translateStateIdentifier(new BigInteger(stateID)));
        }

        for (parser.State state : states) {
            outStates.add(convertApiState(state));

            TransitionList<Double> transitionList = new TransitionList<>(Evaluator.forDouble());
            updater.calculateTransitions(state, transitionList);
            for (int i = 0; i < transitionList.getNumChoices(); i++) {
                boolean contained = true;
                Choice<Double> choice = transitionList.getChoice(i);
                Map<parser.State, Double> probabilities = new HashMap<>();

                for (int j = 0; j < choice.size(); j++) {
                    double probability = choice.getProbability(j);
                    parser.State target = choice.computeTarget(j, state, modulesFile.createVarList());
                    if (!states.contains(target)) {
                        contained = false;
                    }
                    probabilities.put(target, probability);
                }
                if (contained) {
                    transitions.add(convertApiTransition(state, choice, probabilities));
                }
            }
        }
        return new Graph(project, outStates, transitions);
    }

    public Graph getOutgoing(List<String> stateIDs) throws Exception {
        List<parser.State> states = new ArrayList<>();
        List<prism.api.State> outStates = new ArrayList<>();
        List<Transition> transitions = new ArrayList<>();

        for (String stateID : stateIDs) {
            states.add(translateStateIdentifier(new BigInteger(stateID)));
        }

        for (parser.State state : states) {
            outStates.add(convertApiState(state));

            TransitionList<Double> transitionList = new TransitionList<>(Evaluator.forDouble());
            updater.calculateTransitions(state, transitionList);
            for (int i = 0; i < transitionList.getNumChoices(); i++) {
                Choice<Double> choice = transitionList.getChoice(i);

                Map<parser.State, Double> probabilities = new HashMap<>();

                for (int j = 0; j < choice.size(); j++) {
                    double probability = choice.getProbability(j);
                    parser.State target = choice.computeTarget(j, state, modulesFile.createVarList());
                    outStates.add(convertApiState(target));
                    probabilities.put(target, probability);
                }

                transitions.add(convertApiTransition(state, choice, probabilities));
            }
        }
        return new Graph(project, outStates, transitions);

    }

    public Graph resetGraph(List<String> stateIDs, List<String> unexploredStateIDs) throws Exception {
        List<parser.State> states = new ArrayList<>();
        List<prism.api.State> outStates = new ArrayList<>();
        List<Transition> transitions = new ArrayList<>();

        for (String stateID : stateIDs) {
            states.add(translateStateIdentifier(new BigInteger(stateID)));
        }

        for (parser.State state : states) {
            outStates.add(convertApiState(state));

            TransitionList<Double> transitionList = new TransitionList<>(Evaluator.forDouble());
            updater.calculateTransitions(state, transitionList);
            for (int i = 0; i < transitionList.getNumChoices(); i++) {
                Choice<Double> choice = transitionList.getChoice(i);

                Map<parser.State, Double> probabilities = new HashMap<>();

                for (int j = 0; j < choice.size(); j++) {
                    double probability = choice.getProbability(j);
                    parser.State target = choice.computeTarget(j, state, modulesFile.createVarList());
                    outStates.add(convertApiState(target));
                    probabilities.put(target, probability);
                }

                transitions.add(convertApiTransition(state, choice, probabilities));
            }
        }

        for (String stateID : unexploredStateIDs) {
            if (outStates.stream().noneMatch(s -> s.getId().equals(stateID))){
                parser.State state = translateStateIdentifier(new BigInteger(stateID));
                outStates.add(convertApiState(state));
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
