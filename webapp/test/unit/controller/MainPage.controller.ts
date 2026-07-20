/*global QUnit*/
import Controller from "id/apnv/app/xml2jsonui5/controller/Main.controller";

QUnit.module("Main Controller");

QUnit.test("I should test the Main controller", function (assert: Assert) {
	const oAppController = new Controller("Main");
	oAppController.onInit();
	assert.ok(oAppController);
});