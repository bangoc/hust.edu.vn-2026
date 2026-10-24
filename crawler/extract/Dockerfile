FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
RUN mvn -B -q dependency:go-offline
COPY src ./src
RUN mvn -B -q package

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/target/hust-extract.jar ./hust-extract.jar
COPY --from=build /src/target/lib ./lib
EXPOSE 8080
CMD ["java", "-jar", "hust-extract.jar"]
