# Feature definitions (proposal §3.4.3, SO2)

All features are computed per one-minute epoch. Missing values are `NaN`, never
zero, when the feature is undefined.

| Column | Definition | Unit |
|---|---|---|
| `typing_rate` | key + Backspace events in the epoch / minutes | keys·min⁻¹ |
| `inter_key_mean_ms` | mean gap between consecutive key events | ms |
| `inter_key_cv` | SD / mean of consecutive gaps (coefficient of variation) | — |
| `backspace_ratio` | Backspace/Delete events / all key events | 0–1 |
| `burst_count` | runs of keys separated by gaps > `burst_gap_seconds` | bursts·min⁻¹ |
| `mean_burst_duration_s` | mean (last − first) key time within a burst | s |
| `mean_burst_length` | mean number of keys per burst | keys |
| `mouse_path_px` | sum of mouse movement distances | px |
| `mouse_speed_px_s` | `mouse_path_px` / epoch duration | px·s⁻¹ |
| `click_rate` | mouse clicks / minutes | clicks·min⁻¹ |
| `idle_ratio` | 1 − (distinct active seconds / epoch seconds) | 0–1 |
| `switch_rate` | application switches (or browser leaves) / minutes | switches·min⁻¹ |
| `unique_apps` | distinct applications switched to in the epoch | count |
| `app_category_entropy` | Shannon entropy (bits) over category counts | bits |

Notes:

- A second counts as active when at least one interaction event (other than
  leave/return) occurs in it.
- `inter_key_cv` and `backspace_ratio` are `NaN` when fewer than 10 keys were
  pressed in the epoch; rhythm and corrections are undefined then.
- `inter_key_cv` is stored by the current logger as `inter_key_var`; it is a
  coefficient of variation, not a variance in ms².
- Application categories: code editor, document, meeting, messaging,
  browser (learning/other), other.
- The label is not a feature. `participant_id`, `session_id`, probe ratings and
  `focus_label` are excluded from model inputs.

## State, transition and context representation (SO3–SO5)

These columns are added by `scripts/run_states.py`:

| Column | Definition |
|---|---|
| `state` | decoded HMM state at this epoch |
| `state_label` | descriptive label from the state profile |
| `is_interruption` | 1 if the state is interruption-like (frequent switching / idle) |
| `state_dwell` | consecutive epochs in the current state |
| `state_changes_5min` | state changes in the last five epochs |
| `time_since_interruption` | epochs since the last interruption-like state, capped at 5 |
| `interruption_censored` | 1 when no interruption occurred in the last 5 epochs |
| `recovery_epochs` | consecutive non-interruption epochs since the last interruption |
| `recovered` | 1 when `recovery_epochs >= 3` |
| `is_screen` | study mode indicator |
| `task_*` | task one-hot (reference task dropped) |
| `screen_x_*` | screen × activity interactions |
| `state_*` | state one-hot (reference state dropped) |
| `state_*_x_screen`, `state_*_x_task_*` | state-conditioned context interactions |
