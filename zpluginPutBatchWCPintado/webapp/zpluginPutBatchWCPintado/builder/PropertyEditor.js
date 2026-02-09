sap.ui.define([
    "sap/ui/model/resource/ResourceModel",
    "sap/dm/dme/podfoundation/control/PropertyEditor"
], function (ResourceModel, PropertyEditor) {
    "use strict";
    
    var oFormContainer;

    return PropertyEditor.extend( "serviacero.custom.plugins.zpluginPutBatchWCPintado.zpluginPutBatchWCPintado.builder.PropertyEditor" ,{

		constructor: function(sId, mSettings){
			PropertyEditor.apply(this, arguments);
			
			this.setI18nKeyPrefix("customComponentListConfig.");
			this.setResourceBundleName("serviacero.custom.plugins.zpluginPutBatchWCPintado.zpluginPutBatchWCPintado.i18n.builder");
			this.setPluginResourceBundleName("serviacero.custom.plugins.zpluginPutBatchWCPintado.zpluginPutBatchWCPintado.i18n.i18n");
		},
		
		addPropertyEditorContent: function(oPropertyFormContainer){
			var oData = this.getPropertyData();
			
			this.addInputField(oPropertyFormContainer, "autoRefresh", oData);
			this.addInputField(oPropertyFormContainer, "mandante", oData);

            oFormContainer = oPropertyFormContainer;
		},
		
		getDefaultPropertyData: function(){
			return {
				
				"autoRefresh": 15,
				"mandante": "100"
                
			};
		}

	});
});