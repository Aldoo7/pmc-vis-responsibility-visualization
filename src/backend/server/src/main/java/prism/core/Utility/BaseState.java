package prism.core.Utility;

import parser.ast.Expression;
import parser.ast.ModulesFile;
import parser.type.Type;
import parser.type.TypeBool;
import parser.type.TypeDouble;
import parser.type.TypeInt;
import prism.PrismLangException;
import prism.core.ModelParser;
import prism.core.Project;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;


/**
 * State in the base project. Used to encapsulate parser information together with information of the built project. Try not to use it.
 */
public class BaseState {
    private final parser.State state;

    private final String stateID;
    private final Project parent;

    private static final Type[] valueTypes = {TypeInt.getInstance(), TypeDouble.getInstance(), TypeBool.getInstance()};

    public BaseState(String stateID, String stringValues, Project parent) throws PrismLangException {
        this.stateID = stateID;
        this.parent = parent;
        String intern = stringValues;

        // Remove parentheses if neccesary
        if(intern.startsWith("(")){
            intern = stringValues.substring(1, stringValues.length()-1);
        }

        //Replace , by ;
        if (!intern.contains(";")){
            intern = intern.replace(",", ";");
        }

        //Construct Prism State manually , Prism internal function slightly broken
        String[] ids = intern.split(";");
        this.state = new parser.State(ids.length);

        if (!stringValues.contains("=")){
            //Assignment per order
            int i = 0;
            for (String id : ids) {
                String assignment = id.strip();
                Object value = null;
                for (Type t : valueTypes) {
                    try {
                        value = ModelParser.castStringToType(assignment, t);
                        break;
                    } catch (PrismLangException e) {
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
        }else{
            //Direkt Assignment
            for (String id : ids) {
                String[] assignment = id.split("=");
                if (assignment.length != 2) {
                    throw new PrismLangException("Invalid assignment: " + id);
                }
                Object value = null;
                for (Type t : valueTypes) {
                    try {
                        value = ModelParser.castStringToType(assignment[1], t);
                        break;
                    } catch (PrismLangException e) {
                        value = null;
                    } catch (NumberFormatException e){
                        value = null;
                    }
                }
                if (value == null) {
                    throw new PrismLangException("Invalid value in: " + id);
                }
                state.setValue(parent.getModulesFile().getVarIndex(assignment[0]), value);
            }
        }
    }

    public BaseState(String stateID, parser.State state, Project parent){
        this.stateID = stateID;
        this.state = state;
        this.parent = parent;
    }

    public Map<String, Object> getStateVariables(){
        Map<String, Object> variables = new HashMap<>();
        for (int i = 0; i< state.varValues.length; i++){
            variables.put(parent.getModulesFile().getVarName(i), state.varValues[i]);
        }
        return variables;
    }

    public boolean checkForProperty(String expression) throws PrismLangException {
        return parseExpression(expression).evaluateBoolean(state);
    }

    private Expression parseExpression(String expression) throws PrismLangException
    {
        ModulesFile model = parent.getModulesFile();
        Expression expr = parent.getModelParser().parseSingleExpressionString(expression);
        expr = (Expression) expr.findAllFormulas(model.getFormulaList());
        expr = (Expression) expr.expandFormulas(model.getFormulaList(), false);
        expr = (Expression) expr.findAllConstants(model.getConstantList());
        expr = (Expression) expr.expandConstants(model.getConstantList());
        expr = (Expression) expr.findAllVars(model.getVarNames(), model.getVarTypes());
        expr.typeCheck();
        return expr;
    }

    public List<String> getLabels() throws Exception {
        List<String> labels = new ArrayList<>();
        for (int i = 0; i < parent.getModulesFile().getLabelList().size(); i++){
            if (parent.getModulesFile().getLabelList().getLabel(i).evaluateBoolean(state)){
                labels.add(parent.getModulesFile().getLabelName(i));
            }
        }
        return labels;
    }

    public double getStateReward(String rewardFunction) throws PrismLangException {
        double[] rewards = new double[parent.getModulesFile().getNumRewardStructs()];
        parent.getUpdater().calculateStateRewards(state, rewards);

        return rewards[parent.getModulesFile().getRewardStructIndex(rewardFunction)];
    }

    public boolean isInitial() throws PrismLangException {
        if (parent.getModulesFile().getInitialStates() != null){
            return parent.getModulesFile().getInitialStates().evaluateBoolean(state);
        }
        return this.state.equals(parent.getModulesFile().getDefaultInitialState());
    }

    @Override
    public String toString() {
        return state.toString(parent.getModulesFile());
    }

    @Override
    public boolean equals(Object o)
    {
        if (o == this)
            return true;
        if (!(o instanceof BaseState))
            return false;

        return this.toString().equals(o.toString());
    }

    @Override
    public int hashCode()
    {
        return this.state.hashCode();
    }

    public Project getParent() {
        return this.parent;
    }

    public parser.State getParserObject(){
        return this.state;
    }

    public String getStateID() {return this.stateID;}
}
