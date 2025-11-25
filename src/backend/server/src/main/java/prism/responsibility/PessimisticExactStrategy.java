package prism.responsibility;

/**
 * Deprecated legacy pessimistic strategy.
 * Replaced by PessimisticExactStrategyCorrected. Kept only as a marker.
 */
@Deprecated
public class PessimisticExactStrategy implements ResponsibilityStrategy {
    @Override
    public ResponsibilityOutput compute(TransitionSystem ts, Counterexample rho, int level, ResponsibilityEnums.PowerIndex powerIndex) {
        throw new UnsupportedOperationException("Deprecated: use PessimisticExactStrategyCorrected");
    }
}
