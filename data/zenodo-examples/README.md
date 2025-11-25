# Zenodo Examples for PMCVis

These examples are from the official actor-based responsibility tool release:
https://zenodo.org/records/13738447

## Available Examples

### ✅ RECOMMENDED for PMCVis (Fast, < 1 minute):

#### 1. 3_generals_a.prism ⭐ BEST
**Scenario**: Three generals coordination problem
- **Error state**: Partial damage with all generals attacking
- **Size**: **20 states** (VERY FAST - seconds)
- **Runtime**: ~5-10 seconds
- **Use case**: Small coordination protocol

#### 2. dining_philosophers_a.prism ⭐ GOOD
**Scenario**: Dining philosophers deadlock problem
- **Error state**: Deadlock state (no forks held, no one eating)
- **Size**: **36 states** (FAST - seconds)
- **Runtime**: ~10-20 seconds
- **Use case**: Classic concurrency problem

#### 3. broken_window.prism
**Scenario**: Broken window scenario with multiple actors (Rebeca, Ada, Julia)
- **Error state**: `window_type=3` (broken window)
- **Size**: **50 states** (original) / 121 states (preprocessed)
- **Runtime**: ~1-4 minutes
- **Use case**: Module-based responsibility example

### ⚠️ SLOW for PMCVis (Will take long time):

#### 4. puzzle_box.prism
**Scenario**: Puzzle box with buttons that modify a counter
- **Error state**: `counter!=60 & steps=20` (failed to reach target in time)
- **Size**: **1,011 states**
- **Runtime**: Hours (not recommended for state-level)
- **Use case**: Action-based responsibility example

#### 5. brp_1.prism ❌ NOT RECOMMENDED
**Scenario**: Bounded Retransmission Protocol (communication protocol)
- **Error state**: `s=5` (sender enters error state)
- **Size**: **5,192 states**
- **Runtime**: Many hours or days (impractical)
- **Use case**: Realistic protocol, only for module/action grouping

## How to Run in PMCVis

1. **Start the backend** (if not already running):
   ```bash
   /Users/aldo/pmc-vis2/start_server_direct.sh > /Users/aldo/pmc-vis2/server.log 2>&1 &
   ```

2. **Start the frontend** (in a separate terminal):
   ```bash
   cd /Users/aldo/pmc-vis2/src/frontend && npm run dev
   ```

3. **Open PMCVis** in your browser:
   - URL: http://localhost:3001 (or the port shown by Vite)

4. **Upload a model**:
   - Click "Upload Model"
   - Select both `.prism` and `.props` files
   - Example: `broken_window.prism` + `broken_window.props`

5. **Run Responsibility Analysis**:
   - Click on "Responsibility" tab
   - Select power index: `shapley` or `banzhaf`
   - Click "Start" button
   - Wait for analysis to complete
   - **Nodes will be colored** based on responsibility values

## Important Notes

- ✅ All examples are **deterministic MDPs** (compatible with the tool)
- ✅ Each model has both `"sbad"` (original) and `"error"` (PMCVis) labels
- ⚠️ **Frontend initialization**: If you restart the backend, open browser console and run:
  ```javascript
  delete window.__RESP_CTRL_INIT__
  ```
  Then do a hard refresh (Cmd+Shift+R on Mac)

## Comparison: Command-line vs PMCVis

**Command-line** (direct tool usage):
```bash
bw-responsibility -p broken_window.prism -b "sbad" -g "module" \
  --prism-path ~/opt/prism-source/prism/bin/prism
```

**PMCVis** (via web interface):
- Uses `-g "individual"` (state-level responsibility)
- Automatically uses `-b "error"` label
- Visualizes results as node colors in the graph
- Shows state-by-state responsibility values

## Expected Results (STATE-LEVEL RESPONSIBILITY)

⚠️ **IMPORTANT**: PMCVis uses `-g individual` (state-level responsibility), which is MUCH slower than the command-line examples that use module/action/label grouping.

### broken_window.prism
- **121 states** - Will take **~4 minutes** to complete
- ⚠️ Long wait time, but will finish
- Some states have high responsibility for the broken window

### puzzle_box.prism
- **1,011 states** - Will take **hours**
- ❌ **NOT RECOMMENDED** for PMCVis
- Use command-line with `-g action` instead

### brp_1.prism
- **5,192 states** - Will take **hours or days**
- ❌ **DO NOT USE** with PMCVis state-level responsibility
- Use command-line with `-g label` instead

## Recommended Models for PMCVis

Use these instead - designed for state-level responsibility:
- ✅ `/Users/aldo/pmc-vis2/data/test-responsibility/mutex_bug.prism` (~1 second)
- ✅ `/Users/aldo/pmc-vis2/data/test-responsibility/simple_error.prism` (~1 second)
- ✅ `/Users/aldo/pmc-vis2/data/test-responsibility/resource_bug.prism` (fast)

## Troubleshooting

**If analysis fails**:
1. Check backend logs: `tail -50 /Users/aldo/pmc-vis2/server.log`
2. Verify backend is running: `curl http://localhost:8081/healthcheck`
3. Check browser console for errors
4. Ensure model has `label "error"` defined

**If results don't appear**:
1. Delete `window.__RESP_CTRL_INIT__` in browser console
2. Hard refresh (Cmd+Shift+R)
3. Try analysis again
