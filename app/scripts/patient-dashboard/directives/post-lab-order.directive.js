/* global angular */
/*
 jshint -W003, -W026
 */
(function () {
    'use strict';

    angular
        .module('app.patientdashboard')
        .directive('postLabOrder', postLabOrderDirective);

    function postLabOrderDirective() {
        return {
            restict: 'E',
            scope: {
                patient: '=',
                hivSummary: '=',
                order: '=',
                modalObject: '='
            },
            controller: postLabOrderController,
            link: postLabOrderLink,
            templateUrl: 'views/patient-dashboard/post-lab-order.html'
        };
    }

    postLabOrderController.$inject = ['$scope', 'IdentifierResService', 'UtilService',
        'OrderResService', 'LabPostingHelperService', 'EtlRestService', 'LabOrderSearchService', '$filter',
        'moment'];

    function postLabOrderController($scope, IdentifierResService, UtilService,
        OrderResService, labPostingHelper, EtlRestService, LabOrderSearchService, $filter, moment) {

        var customOrderObjectDefinition =
            'custom:(display,uuid,orderNumber,accessionNumber,orderReason,orderReasonNonCoded,urgency,action,' +
            'commentToFulfiller,dateActivated,instructions,orderer:default,encounter:full,patient:default,concept:ref)';

        //lists
        var sampleTypes = labPostingHelper.getSampleTypes();
        var labLocations = labPostingHelper.getLabLocations();
        var orderTypes = labPostingHelper.getOrderTypes();

        //variables
        $scope.isBusy = false;
        $scope.hasError = false;
        $scope.hasLaodingError = false;
        $scope.errorMessage = '';

        $scope.orderType = null;
        $scope.labLocations = labLocations;
        $scope.sampleTypes = sampleTypes;

        //extracted information used to post orders
        $scope.patientName = '';
        $scope.patientIdentifier = '';
        $scope.sex = '';
        $scope.birthDate = null;

        $scope.artStartDateInitial = null;
        $scope.artStartDateCurrent = null;
        $scope.currentArtRegimen = '';
        $scope.currentArtRegimenId = null;
        $scope.locationDisplay = "";

        $scope.patientUuid = LabOrderSearchService.getPatient() ? LabOrderSearchService.getPatient().uuid : null;
        $scope.isOrderSearch = LabOrderSearchService.getIsOrderSearch();
        LabOrderSearchService.setIsOrderSearch(false);

        //used for mocking
        // $scope.artStartDateInitial = new Date(2014,1,1);
        // $scope.artStartDateCurrent = new Date(2015, 1, 1);
        // $scope.currentArtRegimen = 'Nevirapine';
        // $scope.currentArtRegimenId = '6159##628##633';

        //User input variables
        $scope.dateReceived = new Date();
        $scope.selectedSampleType =sampleTypes[0].id;
        $scope.selectedLabLocation = labLocations[1].value;

        //functions
        $scope.loadOrder = loadOrder;
        $scope.postOrder = postOrder;
        $scope.closeDialogWindow = closeDialogWindow;

        activate();

        function activate() {

            $scope.orderType = labPostingHelper.determineOrderType($scope.order);
            //if (!hasLoadingTimeRequiredInputs())
              //  return;
            loadOrder($scope.order.uuid);
            extractPatientInformation();
            extractHivSummaryInformation();
        }

        //functions to validate data
        function hasLoadingTimeRequiredInputs() {
            if (_.isEmpty($scope.order)) {
                displayError('Error loading order information. Please try again.');
                $scope.hasLaodingError = true;
                return false;
            }

            if (_.isEmpty($scope.patient)) {
                displayError('Error loading patient information. Please try again.');
                $scope.hasLaodingError = true;
                return false;
            }

            if (_.isEmpty($scope.hivSummary) && $scope.orderType.type === 'VL') {
                displayError('Error loading hiv summary information. Please try again.');
                $scope.hasLaodingError = true;
                return false;
            }

            return true;
        }

        function isUserInputValid() {
            clearErrorMessage(); s
            if (_.isEmpty($scope.selectedLabLocation)) {
                displayError('Lab Location is required.');
                return false;
            }

            if (_.isEmpty($scope.selectedSampleType) && $scope.orderType.type === 'VL') {
                displayError('Sample type is required.');
                return false;
            }

            if (!moment($scope.dateReceived).isValid()) {
                displayError('Date Received is required.');
                return false;
            }

            return true;
        }

        //functions to extract required data from the various loading time inputs

        function extractHivSummaryInformation() {

            if($scope.hivSummary && !$scope.hivSummary.hasOwnProperty('arvFirstRegimenStartDate'))
              return;

            $scope.artStartDateInitial = new Date($scope.hivSummary.arvFirstRegimenStartDate());
            $scope.artStartDateCurrent = new Date($scope.hivSummary.arvStartDate());
            $scope.currentArtRegimenId = $scope.hivSummary.curArvMedsId();
            $scope.currentArtRegimen = $scope.hivSummary.curArvMeds();
        }

        function extractPatientInformation() {
            $scope.patientName = $scope.patient.fullNames();
            $scope.patientIdentifier = $scope.patient.commonIdentifiers().ampathMrsUId ||
                $scope.patient.commonIdentifiers().amrsMrn ||
                $scope.patient.commonIdentifiers().cCC ||
                $scope.patient.commonIdentifiers().kenyaNationalId;
            $scope.sex = $filter('lowercase')($scope.patient.gender());
            $scope.birthDate = $scope.patient.birthdate();
        }

        //load full order object in order to access all info about order required for posting
        function loadOrder(orderUuid) {
            if ($scope.isBusy === true)
                return;

            $scope.isBusy = true;
            $scope.hasError = false;
            OrderResService.getOrderByUuid(orderUuid, onLoadOrderSuccess, onLoadOrderError, customOrderObjectDefinition);
        }

        function onLoadOrderSuccess(order) {
            $scope.isBusy = false;
            $scope.order = order;
            $scope.locationDisplay = $scope.order.encounter.location.display;
        }

        function onLoadOrderError(error) {
            $scope.isBusy = false;
            displayError('Error loading order information. Please try again.');
        }

        //functions to post order to EID through ETL
        function postOrder() {
            if ($scope.isBusy) return;
            if (!isUserInputValid()) return;
            var payload = getPayload();

            clearErrorMessage();
            $scope.isBusy = true;

            EtlRestService.postOrderToEid($scope.selectedLabLocation, payload,
                postOrderSuccessful, postOrderError);
        }

        function getPayload() {
            var payload;
            var order = $scope.order;
            var obs = $scope.order.encounter.obs;
            var locationUuid = $scope.order.encounter.location.uuid;
            var patientIdentifier = $scope.patientIdentifier;
            var patientName = $scope.patientName;
            var sex = $scope.sex;
            var birthDate = $scope.birthDate;

            if ($scope.orderType === null || $scope.orderType === undefined) {
                displayError('Unknown order type.');
                return;
            }

            if ($scope.orderType.type === 'Other') {
                displayError('Unsupported order type.');
                return;
            }

            if ($scope.orderType.type === 'DNAPCR')
                payload =
                    labPostingHelper.createDnaPcrPayload(order, obs, locationUuid,
                        patientIdentifier, patientName, sex, birthDate, $scope.dateReceived);

            if ($scope.orderType.type === 'VL')
                payload =
                    labPostingHelper.createViralLoadPayload(order, obs, locationUuid,
                        patientIdentifier, patientName, sex, birthDate, $scope.dateReceived,
                        $scope.artStartDateInitial, $scope.artStartDateCurrent, $scope.selectedSampleType, $scope.currentArtRegimenId);

            if ($scope.orderType.type === 'CD4')
                payload =
                    labPostingHelper.createCD4Payload(order, obs, locationUuid,
                        patientIdentifier, patientName, sex, birthDate, $scope.dateReceived);

            return payload;
        }

        function postOrderSuccessful(savedEidOrder) {
            $scope.isBusy = false;
            //close window logic
            closeDialogWindow();
        }

        function postOrderError(error) {
            $scope.isBusy = false;
            displayError('There was an error trying to save the order in the EID system.');
        }

        //helper functions
        function closeDialogWindow() {
            if ($scope.modalObject) {
                $scope.modalObject.dismiss('ok');
            }
        }
        function displayError(message) {
            $scope.hasError = true;
            $scope.errorMessage = message;
        }

        function clearErrorMessage() {
            $scope.hasError = false;
            $scope.errorMessage = '';
        }
    }

    function postLabOrderLink(scope, element, attrs, vm) {
    }

})();
