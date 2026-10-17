FROM node:20-alpine AS builder

WORKDIR /app

# 패키지 정보 복사 및 의존성 설치
COPY package.json package-lock.json* ./
RUN npm ci

# 소스 복사 및 빌드
COPY . .
ARG BACKEND_URL=http://backend:8080
ENV BACKEND_URL=$BACKEND_URL
RUN npm run build

# -----------------------------------
FROM node:20-alpine

WORKDIR /app

# 빌드 결과물 복사
COPY --from=builder /app ./

# 넥스트 앱 포트
ENV PORT=3333
EXPOSE 3333

# 서버 실행
CMD ["npm", "start"]
