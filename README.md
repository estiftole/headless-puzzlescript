# Headless Puzzlescript
A Puzzlescript wrapper written in Node.js to automate gameplay.

# Setup
```bash
# Clone repo
git clone -b main https://github.com/estiftole/headless-puzzlescript.git
cd headless-puzzlescript

# Install packages
npm install

# Run websocket server
node servers/wss.js
```

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
def run_single_game(game_id):
    env = WebSocketGameEnv()
    env.start_session()

    step_seq = ['Up', 'Down', 'Left', 'Right']
    env.perform_step_sequence(step_seq)
    env.draw()

    env.close()
```

## Run multiple parallel game threads
```python
import concurrent.futures

if __name__ == "__main__":
    num_games = 1
    print(f"Launching {num_games} parallel game sessions concurrently...\n")

    total_start = time.time()

    # ThreadPoolExecutor opens separate WebSocket connections for each game thread
    with concurrent.futures.ThreadPoolExecutor(max_workers=num_games) as executor:
        futures = [executor.submit(run_single_game, i) for i in range(num_games)]
        results = [f.result() for f in futures]

    print("\n--- Finished ---")
```
