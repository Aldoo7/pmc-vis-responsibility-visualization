package prism.core.Scheduler;

public class CriteriaFilter implements Criteria{
    public enum Limit{UPPER, LOWER};

    private final int limitValue;
    private final Limit limitType;
    private final String collumn;

    public CriteriaFilter(String collumn, int limitValue, Limit limitType){
        this.limitValue = limitValue;
        this.limitType = limitType;
        this.collumn = collumn;
    }

    public String getOrder(){
        switch (limitType){
            case UPPER:
                return String.format("(%s > %s) DESC", collumn, limitValue);
            case LOWER:
                return String.format("(%s < %s) DESC", collumn, limitValue);
        }
        throw new RuntimeException("Unsupported limit type");
    }
}
