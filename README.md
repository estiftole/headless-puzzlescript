# Headless Puzzlescript
A Node JS Puzzlescript wrapper to run games in headless mode. It runs the original [Puzzlescript game engine](https://github.com/increpare/PuzzleScript) in a mock-DOM and interacts with it through native functions. This wrapper is likely compatible with any Puzzlescript game, but it is a work-in-progress so universal compatiblity is not guaranteed.

# Setup
```bash
# Clone repo
git clone -b main https://github.com/estiftole/headless-puzzlescript.git
cd headless-puzzlescript

# Install packages
npm install

# Run websocket server
node servers/singe_env/wss.js
```

To use your Puzzlescript game:
- Paste its code into a file with a `.ps` extension
- Put that file in `/sources`
- Modify `SOURCE_PATH` in `workers/singleEnvWorker.js`
- Test that it works by running `node template.js`
- Start websocket server with `node servers/singe_env/wss.js`

# Python Example

## Setup websocket wrapper
```python
import json
import time
import websocket


class WebSocketGameEnv:
    def __init__(self, uri="ws://localhost:8080"):
        self.uri = uri
        self.ws = websocket.create_connection(uri)
        self.session_id = None

    def start_session(self, perfect_mode=False):
        # Start a new game session
        self.ws.send(json.dumps({
            'type': 'start_session',
            'perfect_mode': perfect_mode
        }))
        res = json.loads(self.ws.recv())
        self.session_id = res["sessionId"]

    def step(self, action, log_transition=False):
        # Perform a single step in the environment
        self.ws.send(json.dumps({
            'sessionId': self.session_id,
            'type': 'step',
            'action': action,
            'log_transition': log_transition
        }))

    def perform_step_sequence(self, step_sequence, log_transition=False):
        # Send a step sequence to the server
        self.ws.send(json.dumps({
            'sessionId': self.session_id,
            'type': 'perform_step_sequence',
            'step_sequence': step_sequence,
            'log_transition': log_transition
        }))

    def draw(self):
        # Draw the last game state in the server's terminal
        self.ws.send(json.dumps({
            'sessionId': self.session_id,
            'type': 'draw',
        }))

    def close(self):
        # Close session
        self.ws.close()
```

## Single game thread
```python
def run_single_game(game_id=0):
    env = WebSocketGameEnv()
    env.start_session()

    step_seq = ['Up', 'Down', 'Left', 'Right']
    env.perform_step_sequence(step_seq)
    env.draw()

    env.close()

run_single_game()
```

## Multiple game threads
```python
import concurrent.futures

num_games = 2
print(f"Launching {num_games} parallel game sessions...\n")

total_start = time.time()

# ThreadPoolExecutor opens separate WebSocket connections for each game thread
with concurrent.futures.ThreadPoolExecutor(max_workers=num_games) as executor:
    futures = [executor.submit(run_single_game, i) for i in range(num_games)]
    results = [f.result() for f in futures]
```
