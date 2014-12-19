/**
 * Possible invocations:
 * 		applyBindingsWithValidation(viewModel)
 * 		applyBindingsWithValidation(viewModel, options)
 * 		applyBindingsWithValidation(viewModel, rootNode)
 *		applyBindingsWithValidation(viewModel, rootNode, options)
 */
ko.applyBindingsWithValidation = function (viewModel, rootNode, options) {
	var node = document.body,
		config;

	if (rootNode && rootNode.nodeType) {
		node = rootNode;
		config = options;
	}
	else {
		config = rootNode;
	}

	ko.validation.init();

	if (config) {
		var newConfig = ko.utils.extend({}, ko.validation.configuration);
		ko.utils.extend(newConfig, config);
		ko.validation.utils.setDomData(node, newConfig);
	}

	ko.applyBindings(viewModel, node);
};

//override the original applyBindings so that we can ensure all new rules and what not are correctly registered
var origApplyBindings = ko.applyBindings;
ko.applyBindings = function (viewModel, rootNode) {

	ko.validation.init();

	origApplyBindings(viewModel, rootNode);
};

/**
 *
 * @param initialValue {*} Initial value of the observable.
 * @param [options] {Object} Grouping options. When specified it will force the returned observable to contain
 * errors and isValid properties - regardless of initialValue value.
 * @returns {observable}
 */
ko.validatedObservable = function(initialValue, options) {

	if (!ko.validation.utils.isObject(initialValue) && !options) {
		return ko.observable(initialValue).extend({validatable: true});
	}

	var obsv = ko.observable(initialValue);
	obsv.errors = ko.validation.group(!ko.validation.utils.isObject(initialValue) ? {} : initialValue, options);
	obsv.isValid = ko.observable(obsv.errors().length === 0);

	obsv.subscribe(function(newValue) {
		if (!ko.validation.utils.isObject(newValue)) {
			/*
			 * The validation group works on objects.
			 * Since the new value is a primitive (scalar, null or undefined) we need
			 * to create an empty object to pass along.
			 */
			newValue = {};
		}
		// Force the group to refresh
		obsv.errors._refresh(newValue);
		obsv.isValid(obsv.errors().length === 0);
	});

	// Keep isValid property in sync
	if (ko.isObservable(obsv.errors)) {
		obsv.errors.subscribe(function(errors) {
			obsv.isValid(errors.length === 0);
		});
	}
	else {
		ko.computed(obsv.errors).subscribe(function(errors) {
			obsv.isValid(errors.length === 0);
		});
	}
	return obsv;
};
