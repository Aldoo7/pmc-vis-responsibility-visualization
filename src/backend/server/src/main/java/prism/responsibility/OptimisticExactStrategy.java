package prism.responsibility;

/**
 * Deprecated legacy optimistic strategy.
 * Replaced by OptimisticExactStrategyCorrected. Kept only as a marker.
 */
@Deprecated
public class OptimisticExactStrategy implements ResponsibilityStrategy {
    @Override
    public ResponsibilityOutput compute(TransitionSystem ts, Counterexample rho, int level, ResponsibilityEnums.PowerIndex powerIndex) {
        throw new UnsupportedOperationException("Deprecated: use OptimisticExactStrategyCorrected");
    }
}
