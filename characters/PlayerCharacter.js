// /characters/PlayerCharacter.js
import { CharacterBase } from "./CharacterBase.js";
import { createPlayerModel } from "../models/playerModel.js";
import * as THREE from "three";

export class PlayerCharacter extends CharacterBase {
  constructor(username, modelPath, teamColor = null) {
    const { model, nameLabel } = createPlayerModel(
      THREE,
      username,
      ({ mixer, actions }) => {
        this.mixer = mixer;
        this.actions = actions;
      },
      modelPath,
      teamColor
    );
    super(model);
    this.nameLabel = nameLabel;
  }
}
