package prism.db.mappers;

import prism.StateAndValueConsumer;
import prism.core.ModelParser;

import java.math.BigInteger;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.stream.Collectors;

public class StateAndValueMapper implements StateAndValueConsumer {

    private final ModelParser modelParser;
    private final Map<BigInteger, Double> valueMap;

    public StateAndValueMapper(ModelParser modelParser) {
        this.modelParser = modelParser;
        this.valueMap = new HashMap<>();
    }

    @Override
    public void accept(int[] varValues, double value, long stateIndex) {
        BigInteger s_id = modelParser.stateIdentifier(varValues);
        valueMap.put(s_id, value);
    }

    public Map<BigInteger, Double> output(){
        return valueMap;
    }
}
