# syntax=docker/dockerfile:1
# Build context is the repo root (railway.json sets it); this file lives in backend/.

FROM node:22-alpine AS web
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.ts tsconfig.json ./
COPY src src
COPY schema schema
COPY shared shared
COPY public public
RUN npm run build

FROM eclipse-temurin:25-jdk AS build
WORKDIR /src
COPY backend/gradlew gradlew
COPY backend/gradle gradle
COPY backend/settings.gradle.kts backend/build.gradle.kts ./
RUN chmod +x gradlew && ./gradlew --no-daemon dependencies > /dev/null 2>&1 || true
COPY backend/src src
# component types shared with the browser (build.gradle.kts adds ../shared as a resource folder)
COPY shared /shared
COPY --from=web /web/dist src/main/resources/static
RUN ./gradlew --no-daemon bootJar -x test

FROM eclipse-temurin:25-jre
WORKDIR /app
COPY --from=build /src/build/libs/*.jar app.jar
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+UseSerialGC -Xss512k"
EXPOSE 8080
ENTRYPOINT ["java","-jar","/app/app.jar"]
