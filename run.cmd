@echo off
setlocal enabledelayedexpansion

REM Check if Docker is installed
where docker >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo Error: Docker is not installed. Please install Docker Desktop first.
    echo Visit: https://www.docker.com/get-started/
    exit /b 1
)

REM Check if Docker is running
docker info >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo Error: Docker is not running. Please start Docker Desktop.
    exit /b 1
)

REM Check if Docker Compose is installed
where docker-compose >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo Error: Docker Compose is not installed. Please install it first.
    echo It should be included with Docker Desktop.
    exit /b 1
)

REM Check if Python virtual environment is activated
if "%VIRTUAL_ENV%"=="" (
    echo Python virtual environment is not activated.
    if exist agentic_seek_env\Scripts\activate.bat (
        echo Activating virtual environment...
        call agentic_seek_env\Scripts\activate.bat
        if "%VIRTUAL_ENV%"=="" (
            echo Failed to activate virtual environment. Please activate it manually:
            echo call agentic_seek_env\Scripts\activate.bat
            exit /b 1
        ) else (
            echo Virtual environment activated.
        )
    ) else (
        echo Virtual environment not found. Please create and activate it first:
        echo python -m venv agentic_seek_env
        echo call agentic_seek_env\Scripts\activate.bat
        exit /b 1
    )
) else (
    echo Python virtual environment is already activated: %VIRTUAL_ENV%
)

REM Check if port 8000 is already in use
netstat -ano | findstr :8000 >nul
if %ERRORLEVEL% equ 0 (
    echo Warning: Port 8000 is already in use. Another instance of the backend may be running.
    echo Please stop it before continuing.
    set /p CONTINUE=Do you want to continue anyway? (y/n): 
    if /i not "!CONTINUE!"=="y" (
        echo Exiting...
        exit /b 1
    )
)

REM Stop any running containers
echo Stopping any running Docker containers...
docker-compose down

REM Start Docker services (frontend, redis, searxng)
echo Starting Docker services (frontend, redis, searxng)...
start /b docker-compose up -d

REM Wait for services to start
echo Waiting for services to start...
timeout /t 5 /nobreak >nul

REM Start the backend service on the host machine
echo Starting backend service on the host machine...
echo The backend will run in this terminal. Press Ctrl+C to stop.
echo You can access the web interface at http://localhost:3000
python api.py

REM This part will only execute if the backend is stopped
echo Backend service stopped.
echo Stopping Docker services...
docker-compose down
echo All services stopped.

endlocal
