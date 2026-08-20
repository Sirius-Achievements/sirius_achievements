pipeline {

  agent any

  triggers {
    githubPush()
  }

  options {
    disableConcurrentBuilds()
    timestamps()
    skipDefaultCheckout(true)
  }

  environment {
    // VPS: Jenkins, nginx and web live here.
    DEPLOY_DIR       = '/root/sirius_achievements'
    VPS_COMPOSE_FILE = 'docker-compose.vps.yml'

    // PC behind OpenVPN. Change user/path if needed.
    PC_HOST         = 'sirius@10.8.0.2'
    PC_VPN_IP       = '10.8.0.2'
    PC_DEPLOY_DIR   = '/home/sirius/sirius_achievements'
    PC_COMPOSE_FILE = 'docker-compose.pc.yml'

    // Jenkins Credentials ID: SSH Username with private key for the PC user.
    SSH_CREDENTIALS_ID = 'deploy-pc-ssh-key'

    APP_IMAGE_BASE = 'sirius-app'
    AI_IMAGE_BASE  = 'sirius-ai-service'

    AI_HEALTH_URL    = 'http://10.8.0.2:8001/health'
    VLLM_HEALTH_URL  = 'http://10.8.0.2:8000/health'
    VLLM_MODELS_URL  = 'http://10.8.0.2:8000/v1/models'
    VLLM_MODEL       = 'Qwen/Qwen2.5-3B-Instruct-AWQ'
    MINIO_HEALTH_URL = 'http://10.8.0.2:9000/minio/health/ready'
    WEB_HEALTH_URL   = 'https://sirius-achievements.ru/health'

    NOTIFY_EMAIL = 'efirkoumir@gmail.com,yaroslavroch2@gmail.com,matveys909@gmail.com,sh1tc0der@yandex.ru'
    // NOTE: SKIP_DEPLOY / IMAGE_TAG / APP_IMAGE / AI_IMAGE are intentionally NOT
    // declared here. In Declarative Pipeline a var declared in environment{} cannot
    // be reliably reassigned via env.X in a script block (reads back null), which is
    // why tag detection produced "sirius-app:null". They are set only in 'Check Tag'.
  }

  stages {

    stage('Checkout') {
      steps {
        checkout scm
        sh 'git fetch --tags --force'
      }
    }

    stage('Check Tag') {
      steps {
        script {
          def exactTag = sh(
            script: "git describe --tags --exact-match 2>/dev/null || true",
            returnStdout: true
          ).trim()

          if (exactTag == '') {
            exactTag = sh(
              script: "git tag --points-at HEAD | sort -V | tail -n 1 || true",
              returnStdout: true
            ).trim()
          }

          if (exactTag == '') {
            env.SKIP_DEPLOY = 'true'
            currentBuild.description = 'No Git tag on HEAD, deployment skipped'
            echo 'No Git tag on this commit. Deployment skipped.'
            return
          }

          env.SKIP_DEPLOY = 'false'
          env.IMAGE_TAG = exactTag
          env.APP_IMAGE = "${env.APP_IMAGE_BASE}:${exactTag}"
          env.AI_IMAGE  = "${env.AI_IMAGE_BASE}:${exactTag}"

          currentBuild.displayName = "#${env.BUILD_NUMBER} ${exactTag}"
          currentBuild.description = "Deploy tag ${exactTag}"
          echo "Tag found: ${exactTag}. Starting deployment."
        }
      }
    }

    stage('Prepare VPS Files') {
      when {
        expression { env.SKIP_DEPLOY != 'true' }
      }
      steps {
        sh '''
          set -e
          mkdir -p "$DEPLOY_DIR"

          rsync -a --delete \
            --exclude='.git/' \
            --exclude='nginx/conf.d/wm.htpasswd' \
            --exclude='nginx/conf.d/wm-extra/' \
            --exclude='.env' \
            --exclude='/models/' \
            --exclude='postgres_data*/' \
            --exclude='minio_data*/' \
            --exclude='redis_data*/' \
            --exclude='jenkins_home/' \
            --exclude='uploads_data/' \
            ./ "$DEPLOY_DIR"/
        '''
      }
    }

    stage('Prepare PC Files') {
      when {
        expression { env.SKIP_DEPLOY != 'true' }
      }
      steps {
        sshagent(credentials: [env.SSH_CREDENTIALS_ID]) {
          sh '''
            set -e

            ssh -o StrictHostKeyChecking=no "$PC_HOST" "mkdir -p '$PC_DEPLOY_DIR' '$PC_DEPLOY_DIR/models'"

            rsync -az --delete -e "ssh -o StrictHostKeyChecking=no" \
              --exclude='.git/' \
              --exclude='.env' \
              --exclude='/models/' \
              --exclude='postgres_data*/' \
              --exclude='minio_data*/' \
              --exclude='redis_data*/' \
              --exclude='jenkins_home/' \
              --exclude='uploads_data/' \
              ./ "$PC_HOST:$PC_DEPLOY_DIR/"
          '''
        }
      }
    }

    stage('Save Current Versions') {
      when {
        expression { env.SKIP_DEPLOY != 'true' }
      }
      steps {
        sshagent(credentials: [env.SSH_CREDENTIALS_ID]) {
          sh '''
            set +e

            APP_PREV=$(docker inspect --format='{{.Config.Image}}' sirius_app_new 2>/dev/null || true)
            echo "$APP_PREV" > /tmp/sirius_prev_app_image.txt
            echo "Current VPS web image: ${APP_PREV:-none}"

            AI_PREV=$(ssh -o StrictHostKeyChecking=no "$PC_HOST" "docker inspect --format='{{.Config.Image}}' sirius_ai_service 2>/dev/null || true")
            echo "$AI_PREV" > /tmp/sirius_prev_ai_image.txt
            echo "Current PC AI image: ${AI_PREV:-none}"
          '''
        }
      }
    }

    stage('Build PC AI Image') {
      when {
        expression { env.SKIP_DEPLOY != 'true' }
      }
      steps {
        sshagent(credentials: [env.SSH_CREDENTIALS_ID]) {
          sh '''
            set -e
            ssh -o StrictHostKeyChecking=no "$PC_HOST" "
              set -e
              compose() {
                if docker compose version >/dev/null 2>&1; then docker compose \"\$@\"; else docker-compose \"\$@\"; fi
              }
              cd '$PC_DEPLOY_DIR'
              AI_IMAGE='$AI_IMAGE' compose -f '$PC_COMPOSE_FILE' build ai_service
            "
          '''
        }
      }
    }

    stage('Deploy PC Services') {
      when {
        expression { env.SKIP_DEPLOY != 'true' }
      }
      steps {
        sshagent(credentials: [env.SSH_CREDENTIALS_ID]) {
          sh '''
            set -e
            ssh -o StrictHostKeyChecking=no "$PC_HOST" "
              set -e
              compose() {
                if docker compose version >/dev/null 2>&1; then docker compose \"\$@\"; else docker-compose \"\$@\"; fi
              }
              cd '$PC_DEPLOY_DIR'
              AI_IMAGE='$AI_IMAGE' VLLM_MODEL='$VLLM_MODEL' compose -f '$PC_COMPOSE_FILE' up -d db redis minio ai_service vllm
            "
          '''
        }
      }
    }

    stage('Health Check PC Services') {
      when {
        expression { env.SKIP_DEPLOY != 'true' }
      }
      steps {
        sshagent(credentials: [env.SSH_CREDENTIALS_ID]) {
          sh '''
            set -e

            echo "Checking AI from VPS/Jenkins network..."
            curl -fsS --max-time 30 "$AI_HEALTH_URL"

            echo "Checking optional vLLM model server..."
            if curl -fsS --max-time 20 "$VLLM_HEALTH_URL" >/dev/null; then
              if curl -fsS --max-time 30 "$VLLM_MODELS_URL" | grep -F "$VLLM_MODEL" >/dev/null; then
                echo "Running a real vLLM chat completion smoke test..."
                if ! curl -fsS --max-time 120 \
                  -H 'Content-Type: application/json' \
                  -d "{\"model\":\"$VLLM_MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"Ответь одним словом: работает\"}],\"max_tokens\":8,\"temperature\":0}" \
                  "http://10.8.0.2:8000/v1/chat/completions" | grep -F '"choices"' >/dev/null; then
                  echo "WARNING: vLLM completion failed; web deployment continues with profile-search fallback."
                fi
              else
                echo "WARNING: configured model is not loaded in vLLM; web deployment continues with fallback."
              fi
            else
              echo "WARNING: vLLM is unavailable; web deployment continues with profile-search fallback."
            fi

            echo "Checking MinIO from VPS/Jenkins network..."
            curl -fsS --max-time 30 "$MINIO_HEALTH_URL"

            echo "Checking PostgreSQL port from VPS/Jenkins network..."
            timeout 10 bash -c "</dev/tcp/$PC_VPN_IP/5433"

            echo "Checking Redis port from VPS/Jenkins network..."
            timeout 10 bash -c "</dev/tcp/$PC_VPN_IP/6379"

            echo "Checking PostgreSQL and Redis inside PC containers..."
            ssh -o StrictHostKeyChecking=no "$PC_HOST" "
              set -e
              cd '$PC_DEPLOY_DIR'
              set -a
              . ./.env
              set +a
              docker exec sirius_db_new pg_isready -U \"\$DB_USERNAME\" -d \"\$DB_NAME\"
              docker exec sirius_redis_new redis-cli -a \"\$REDIS_PASSWORD\" ping
            "
          '''
        }
      }
    }

    stage('Build Web Image on PC and Load to VPS') {
      when {
        expression { env.SKIP_DEPLOY != 'true' }
      }
      steps {
        sshagent(credentials: [env.SSH_CREDENTIALS_ID]) {
          sh '''#!/usr/bin/env bash
            set -euo pipefail

            echo "Building web image on PC (keeps docker build CPU off the VPS)..."
            ssh -o StrictHostKeyChecking=no "$PC_HOST" "
              set -e
              cd '$PC_DEPLOY_DIR'
              docker build --build-arg APP_VERSION='$IMAGE_TAG' -t '$APP_IMAGE' -f Dockerfile .
            "

            echo "Streaming image $APP_IMAGE from PC to VPS over the VPN..."
            ssh -o StrictHostKeyChecking=no "$PC_HOST" "docker save '$APP_IMAGE' | gzip -1" | gunzip | docker load
          '''
        }
      }
    }

    stage('Deploy VPS Web') {
      when {
        expression { env.SKIP_DEPLOY != 'true' }
      }
      steps {
        sh '''
          set -e
          cd "$DEPLOY_DIR"

          compose() {
            if docker compose version >/dev/null 2>&1; then docker compose "$@"; else docker-compose "$@"; fi
          }

          APP_IMAGE="$APP_IMAGE" VLLM_MODEL="$VLLM_MODEL" compose -f "$VPS_COMPOSE_FILE" up -d --no-deps web
          compose -f "$VPS_COMPOSE_FILE" up -d nginx

          echo "Waiting for web container to become healthy..."
          WEB_READY=false
          for attempt in $(seq 1 18); do
            STATUS=$(docker inspect --format='{{.State.Status}}' sirius_app_new 2>/dev/null || echo 'missing')
            HEALTH=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' sirius_app_new 2>/dev/null || echo 'missing')
            echo "Web readiness ${attempt}/18: status=$STATUS health=$HEALTH"
            if [ "$STATUS" = "running" ] && { [ "$HEALTH" = "healthy" ] || [ "$HEALTH" = "none" ]; }; then
              WEB_READY=true
              break
            fi
            sleep 10
          done
          if [ "$WEB_READY" != "true" ]; then
            echo "Web container did not become healthy in time."
            docker logs --tail=100 sirius_app_new || true
            exit 1
          fi
        '''
      }
    }

    stage('Health Check VPS Web') {
      when {
        expression { env.SKIP_DEPLOY != 'true' }
      }
      steps {
        sh '''
          set -e

          STATUS=$(docker inspect --format='{{.State.Status}}' sirius_app_new 2>/dev/null || echo 'missing')
          echo "Container status: $STATUS"
          if [ "$STATUS" != "running" ]; then
            echo "Container is not running!"
            docker logs --tail=100 sirius_app_new || true
            exit 1
          fi

          HTTP='000'
          for attempt in $(seq 1 12); do
            HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 "$WEB_HEALTH_URL" || echo '000')
            echo "Public health ${attempt}/12 returned: $HTTP"
            if [ "$HTTP" = "200" ]; then
              break
            fi
            sleep 10
          done
          if [ "$HTTP" != "200" ]; then
            echo "Health check failed after retries! Got HTTP $HTTP"
            docker logs --tail=100 sirius_app_new || true
            exit 1
          fi
        '''
      }
    }

  }

  post {

    failure {
      script {
        if (env.SKIP_DEPLOY == 'true') {
          echo 'Build was skipped because HEAD has no Git tag. No rollback and no email.'
          return
        }

        echo 'Deployment failed. Starting rollback...'

        sh '''
          set +e

          compose() {
            if docker compose version >/dev/null 2>&1; then docker compose "$@"; else docker-compose "$@"; fi
          }

          APP_PREV=$(cat /tmp/sirius_prev_app_image.txt 2>/dev/null || true)
          if [ -n "$APP_PREV" ]; then
            echo "Rolling back VPS web to: $APP_PREV"
            cd "$DEPLOY_DIR"
            APP_IMAGE="$APP_PREV" compose -f "$VPS_COMPOSE_FILE" up -d --no-deps web
          else
            echo "No previous VPS web image found. Skipping VPS rollback."
          fi
        '''

        sshagent(credentials: [env.SSH_CREDENTIALS_ID]) {
          sh '''
            set +e
            AI_PREV=$(cat /tmp/sirius_prev_ai_image.txt 2>/dev/null || true)
            if [ -n "$AI_PREV" ]; then
              echo "Rolling back PC ai_service to: $AI_PREV"
              ssh -o StrictHostKeyChecking=no "$PC_HOST" "
                compose() {
                  if docker compose version >/dev/null 2>&1; then docker compose \"\$@\"; else docker-compose \"\$@\"; fi
                }
                cd '$PC_DEPLOY_DIR'
                AI_IMAGE='$AI_PREV' compose -f '$PC_COMPOSE_FILE' up -d --no-deps ai_service
              "
            else
              echo "No previous PC AI image found. Skipping PC rollback."
            fi
          '''
        }

        mail(
          to: "${env.NOTIFY_EMAIL}",
          subject: "Deployment failed - ${env.IMAGE_TAG ?: 'no-tag'} - ${env.JOB_NAME}",
          body: """
Deployment failed.

Project: ${env.JOB_NAME}
Tag:     ${env.IMAGE_TAG ?: 'no-tag'}
Build:   #${env.BUILD_NUMBER}

Rollback was attempted automatically.

Images:
App: ${env.APP_IMAGE ?: 'not built'}
AI:  ${env.AI_IMAGE ?: 'not built'}

Logs:
${env.BUILD_URL}console
          """.stripIndent()
        )
      }
    }

    success {
      script {
        if (env.SKIP_DEPLOY == 'true') {
          echo 'HEAD has no Git tag. Deployment skipped successfully.'
          return
        }

        mail(
          to: "${env.NOTIFY_EMAIL}",
          subject: "Deployment succeeded - ${env.IMAGE_TAG} - ${env.JOB_NAME}",
          body: """
Deployment succeeded.

Project: ${env.JOB_NAME}
Tag:     ${env.IMAGE_TAG}
Build:   #${env.BUILD_NUMBER}

Images:
App: ${env.APP_IMAGE}
AI:  ${env.AI_IMAGE}

Health checks:
Web:   ${env.WEB_HEALTH_URL}
AI:    ${env.AI_HEALTH_URL}
vLLM:  ${env.VLLM_HEALTH_URL} (${env.VLLM_MODEL})
MinIO: ${env.MINIO_HEALTH_URL}

Logs:
${env.BUILD_URL}console
          """.stripIndent()
        )

        sh '''
          set +e
          docker image prune -f --filter 'until=72h'
        '''

        sshagent(credentials: [env.SSH_CREDENTIALS_ID]) {
          sh '''
            set +e
            ssh -o StrictHostKeyChecking=no "$PC_HOST" "docker image prune -f --filter 'until=72h' || true"
          '''
        }
      }
    }

  }

}
