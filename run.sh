#!/bin/bash

# Function to check if a command exists
command_exists() {
    command -v "$1" &> /dev/null
}

# Function to check if a process is running on a specific port
is_port_in_use() {
    if command_exists lsof; then
        lsof -i:"$1" &> /dev/null
        return $?
    elif command_exists netstat; then
        netstat -tuln | grep ":$1 " &> /dev/null
        return $?
    else
        echo "Warning: Cannot check if port $1 is in use (neither lsof nor netstat found)"
        return 1
    fi
}

# Check if Docker is installed and running
if ! command_exists docker; then
    echo "Error: Docker is not installed. Please install Docker first."
    echo "On Ubuntu: sudo apt install docker.io"
    echo "On macOS: Install Docker Desktop from https://www.docker.com/get-started/"
    exit 1
fi

# Check if Docker daemon is running
echo "Checking if Docker daemon is running..."
if ! docker info &> /dev/null; then
    echo "Error: Docker daemon is not running or inaccessible."
    if [ "$(uname)" = "Linux" ]; then
        echo "Trying to start Docker service (may require sudo)..."
        if sudo systemctl start docker &> /dev/null; then
            echo "Docker started successfully."
        else
            echo "Failed to start Docker. Possible issues:"
            echo "1. Run this script with sudo: sudo bash run.sh"
            echo "2. Check Docker installation: sudo systemctl status docker"
            echo "3. Add your user to the docker group: sudo usermod -aG docker $USER (then log out and back in)"
            exit 1
        fi
    else
        echo "Please start Docker manually:"
        echo "- On macOS: Open Docker Desktop."
        echo "- On Linux: Run 'sudo systemctl start docker' or check your distro's docs."
        exit 1
    fi
else
    echo "Docker daemon is running."
fi

# Check if Docker Compose is installed
if ! command_exists docker-compose; then
    echo "Error: Docker Compose is not installed. Please install it first."
    echo "On Ubuntu: sudo apt install docker-compose"
    echo "Or via pip: pip install docker-compose"
    exit 1
fi

# Check if Python virtual environment is activated
if [[ -z "$VIRTUAL_ENV" ]]; then
    echo "Python virtual environment is not activated."
    if [ -d "agentic_seek_env" ]; then
        echo "Activating virtual environment..."
        source agentic_seek_env/bin/activate
        if [[ -z "$VIRTUAL_ENV" ]]; then
            echo "Failed to activate virtual environment. Please activate it manually:"
            echo "source agentic_seek_env/bin/activate"
            exit 1
        else
            echo "Virtual environment activated."
        fi
    else
        echo "Virtual environment not found. Please create and activate it first:"
        echo "python3 -m venv agentic_seek_env"
        echo "source agentic_seek_env/bin/activate"
        exit 1
    fi
else
    echo "Python virtual environment is already activated: $VIRTUAL_ENV"
fi

# Stop any running containers
echo "Stopping any running Docker containers..."
docker-compose down

# Start Docker services (frontend, redis, searxng)
echo "Starting Docker services (frontend, redis, searxng)..."
docker-compose up -d

# Check if services are running
echo "Checking if services are running..."
sleep 5

# Check if frontend is running
if ! curl -s http://localhost:3000 > /dev/null; then
    echo "Warning: Frontend service may not be running properly."
else
    echo "Frontend service is running on http://localhost:3000"
fi

# Check if SearXNG is running
if ! curl -s http://localhost:8080 > /dev/null; then
    echo "Warning: SearXNG service may not be running properly."
else
    echo "SearXNG service is running on http://localhost:8080"
fi

# Check if port 8000 is already in use
if is_port_in_use 8000; then
    echo "Warning: Port 8000 is already in use. Another instance of the backend may be running."
    echo "Please stop it before continuing."
    read -p "Do you want to continue anyway? (y/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Exiting..."
        exit 1
    fi
fi

# Start the backend service on the host machine
echo "Starting backend service on the host machine..."
echo "The backend will run in this terminal. Press Ctrl+C to stop."
echo "You can access the web interface at http://localhost:3000"
python3 api.py

# This part will only execute if the backend is stopped
echo "Backend service stopped."
echo "Stopping Docker services..."
docker-compose down
echo "All services stopped."
