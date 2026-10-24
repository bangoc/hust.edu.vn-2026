// Run against the database configured in application.yml. Does not migrate or delete old data.
// Each graph document stores ONE destination, using the requested field name "destinations".
const contentValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["url", "format", "title", "content", "createdAt", "updatedAt"],
    properties: {
      url: {bsonType: "string", pattern: "^[hH][tT][tT][pP][sS]?://", minLength: 1},
      format: {bsonType: "string", minLength: 1},
      title: {bsonType: "string", minLength: 1},
      content: {bsonType: "string"},
      base64: {bsonType: "string", minLength: 1, pattern: "^[A-Za-z0-9+/]+={0,2}$"},
      createdAt: {bsonType: "date"},
      updatedAt: {bsonType: "date"}
    }
  }
};
const graphValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["source", "destinations", "intro", "createdAt", "updatedAt"],
    properties: {
      source: {bsonType: "string", pattern: "^[hH][tT][tT][pP][sS]?://"},
      destinations: {bsonType: "string", pattern: "^[hH][tT][tT][pP][sS]?://"},
      intro: {bsonType: "string", description: "Anchor text from out-links.text; may be empty"},
      createdAt: {bsonType: "date"},
      updatedAt: {bsonType: "date"}
    }
  }
};
function ensureCollection(name, validator) {
  if (db.getCollectionNames().includes(name)) {
    assert.commandWorked(db.runCommand({collMod: name, validator,
      validationLevel: "strict", validationAction: "error"}));
  } else {
    db.createCollection(name, {validator, validationLevel: "strict", validationAction: "error"});
  }
}
for (const name of ["html", "picture", "others"]) {
  // origin is optional and belongs to picture/others only.
  const validator = name === "html" ? contentValidator : {
    $jsonSchema: {
      ...contentValidator.$jsonSchema,
      properties: {
        ...contentValidator.$jsonSchema.properties,
        origin: {bsonType: "string", description: "Optional origin supplied for pictures/documents"}
      }
    }
  };
  ensureCollection(name, validator);
  db.getCollection(name).createIndex({url: 1}, {unique: true, name: "uk_url"});
}
ensureCollection("graph", graphValidator);
db.graph.createIndex({source: 1, destinations: 1}, {unique: true, name: "uk_source_destinations"});
db.graph.createIndex({destinations: 1}, {name: "ix_destinations"});
