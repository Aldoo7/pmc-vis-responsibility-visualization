# Ground Truth: Two Dice Probability Error

## Bug Description
The two dice model implements a protocol where two dice independently flip coins to decide their final value. The bug introduces a bias in one die's decision-making process.

## Bug Location

**Module:** `die1`  
**State Condition:** `s1=3`  
**Line Number:** 16 (in model.prism)  
**Component Type:** Transition probabilities  

**Buggy Code:**
```prism
[] s1=3 -> 0.7 : (s1'=1) + 0.3 : (s1'=7) & (d1'=1);
```

**Should Be:**
```prism
[] s1=3 -> 0.5 : (s1'=1) + 0.5 : (s1'=7) & (d1'=1);
```

## Bug Classification

**Bug Type:** Incorrect probability distribution  
**Severity:** Medium  
**Impact:** Violates fairness - die1 is biased toward looping back to s1 (70% chance) instead of deciding on value 1 (30% chance)

## Property Violation

**Property:** `Pmax=? [ F "die1_decided" & !("die2_decided") ]`

**Expected Result (correct model):** ≈ 0.5 (both dice finish simultaneously on average)  
**Actual Result (buggy model):** > 0.5 (die1 takes longer due to 70% loop-back probability)

**Why Violated:** The bias causes die1 to loop more frequently, delaying its termination. This creates asymmetry between the two dice.

## Responsible Components

### Expected Responsibility Ranking

Based on the bug, we expect:

1. **module_die1** - HIGH (0.8-1.0)
   - Contains the buggy transition
   - Only die1 is affected, die2 is symmetric copy
   
2. **variable_s1** - HIGH (0.7-0.9)
   - State s1=3 is where bug manifests
   - Loop back to s1=1 is abnormally likely
   
3. **state (s1=3, s2=*)** - HIGH (0.6-0.8)
   - Concrete states where wrong probability fires
   
4. **variable_d1** - MEDIUM (0.3-0.5)
   - Affected by bug but not the root cause

5. **module_die2** - LOW (0.1-0.3)
   - Unaffected by bug (correct probabilities)

## Repair Action

**Fix:** Change line 16 probabilities from `0.7/0.3` to `0.5/0.5`

**Verification:** 
1. Run PRISM on corrected model
2. Check `Pmax=? [ F "die1_decided" & !("die2_decided") ]` ≈ 0.5
3. Verify symmetry between die1 and die2

## Debugging Hints

**Symptoms:**
- Die1 finishes later than die2 more often than expected
- Asymmetry between symmetric components (red flag!)
- State s1=3 appears more frequently in traces

**Diagnosis Process:**
1. Compare responsibility of die1 vs die2
2. If die1 >> die2, inspect die1's transitions
3. Look for states in die1 with high responsibility
4. Find s1=3 → check its outgoing transitions
5. Spot the 0.7/0.3 instead of expected 0.5/0.5

## Evaluation Criteria

### Success Metrics
- [ ] **module_die1** in top-3 responsible components
- [ ] **variable_s1** in top-5 responsible variables  
- [ ] State responsibility highlights states with s1=3
- [ ] Optimistic responsibility > 0.7 for die1

### Questions to Answer
1. Does component responsibility rank `module_die1` #1?
2. Does state responsibility point to s1=3 region?
3. Does the asymmetry (die1 vs die2) stand out in visualization?
4. Would a developer quickly notice "die1 has much higher responsibility than die2"?

## Notes

This is an **ideal test case** because:
- Bug is in a single, localized component
- Creates clear asymmetry (die1 ≠ die2) 
- Affects specific states (s1=3)
- Has measurable impact on properties
- Representative of real probability bugs in MDPs

