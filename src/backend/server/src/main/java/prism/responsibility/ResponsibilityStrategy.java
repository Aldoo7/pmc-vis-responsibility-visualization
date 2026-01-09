package prism.responsibility;

import prism.responsibility.ResponsibilityEnums.PowerIndex;

/**
 * Strategy interface for computing responsibility.
 */
public interface ResponsibilityStrategy {
    ResponsibilityOutput compute(TransitionSystem ts, Counterexample rho, int level, PowerIndex powerIndex);
}
